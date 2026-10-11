import fs from "node:fs/promises";
import { watch as watchFiles, type FSWatcher } from "node:fs";
import path from "node:path";
import { pool } from "../database";
import { env } from "../config/env";

const sqlDirectory = path.resolve(__dirname, "../../src/database");
const sqlFiles = new Map([
  ["schema.sql", "schema"],
  ["seed.sql", "catalogue seed"],
]);
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const queued = new Set<string>();
let applyChain = Promise.resolve();
let watcher: FSWatcher | undefined;

async function applySqlFile(fileName: string, label: string): Promise<void> {
  const sql = await fs.readFile(path.join(sqlDirectory, fileName), "utf8");
  if (!sql.trim()) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`[db:watch] Applied ${label} from ${fileName}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db:watch] Could not apply ${fileName}: ${message}`);
  } finally {
    client.release();
  }
}

async function applyQueued(fileName: string, label: string): Promise<void> {
  if (running.has(fileName)) {
    queued.add(fileName);
    return;
  }

  running.add(fileName);
  try {
    do {
      queued.delete(fileName);
      await applySqlFile(fileName, label);
    } while (queued.has(fileName));
  } finally {
    running.delete(fileName);
  }
}

function scheduleApply(fileName: string, label: string): void {
  const previousTimer = timers.get(fileName);
  if (previousTimer) clearTimeout(previousTimer);

  timers.set(fileName, setTimeout(() => {
    timers.delete(fileName);
    applyChain = applyChain.then(() => applyQueued(fileName, label)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[db:watch] Could not read or apply ${fileName}: ${message}`);
    });
  }, 900));
}

async function start(): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is missing. Configure the Supabase PostgreSQL connection in .env.");
  }

  await pool.query("SELECT 1");
  watcher = watchFiles(sqlDirectory, (_event, fileName) => {
    if (!fileName) return;
    const name = fileName.toString();
    const label = sqlFiles.get(name);
    if (label) scheduleApply(name, label);
  });

  console.log("[db:watch] Connected to PostgreSQL. Save schema.sql or seed.sql to apply it to the configured database.");
  console.log("[db:watch] Stop the watcher with Ctrl+C. No SQL runs until one of those files changes.");
}

function stop(): void {
  watcher?.close();
  for (const timer of timers.values()) clearTimeout(timer);
  void pool.end();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

start().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db:watch] Could not start: ${message}`);
  await pool.end();
  process.exitCode = 1;
});
