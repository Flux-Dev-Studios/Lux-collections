import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "../config/env";

const databaseSsl = env.databaseSsl
  ? {
      rejectUnauthorized: true,
      ...(env.databaseSslCa ? { ca: readFileSync(env.databaseSslCa, "utf8") } : {}),
    }
  : undefined;

export const pool = new Pool({
  ...(env.databaseUrl ? { connectionString: env.databaseUrl } : {}),
  ...(databaseSsl ? { ssl: databaseSsl } : {}),
  // Keep connection use bounded across concurrent Vercel function instances.
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 30_000,
  // Supabase free projects may need a few seconds to wake after being idle.
  connectionTimeoutMillis: 20_000,
  statement_timeout: 15_000,
  application_name: "lux-collection",
});

pool.on("error", (error: Error) => {
  console.error("Unexpected error from an idle PostgreSQL connection:", error);
});

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return runQuery<Row>(text, values);
}

const transientConnectionErrors = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export function isTransientConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const candidate = current as NodeJS.ErrnoException;
    if (candidate.code && transientConnectionErrors.has(candidate.code)) return true;
    if (typeof candidate.message === "string" && /connection terminated|connection timeout|timeout exceeded when trying to connect|timeout expired|socket hang up/i.test(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
}

function isReadOnlyQuery(text: string): boolean {
  const statement = text.trimStart();
  return /^(SELECT|SHOW|EXPLAIN)\b/i.test(statement)
    && !/\b(FOR\s+(UPDATE|SHARE)|NEXTVAL\s*\(|SETVAL\s*\()/i.test(statement);
}

async function runQuery<Row extends QueryResultRow>(
  text: string,
  values: unknown[],
): Promise<QueryResult<Row>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await pool.query<Row>(text, values);
    } catch (error) {
      if (!isReadOnlyQuery(text) || attempt >= 2 || !isTransientConnectionFailure(error)) {
        throw error;
      }
      // Only retry reads: a write may have succeeded even if its response was lost.
      await waitBeforeRetry(attempt);
    }
  }
}

async function connectWithRetry(): Promise<PoolClient> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      // Retrying client acquisition is safe because no transaction has begun.
      if (attempt >= 2 || !isTransientConnectionFailure(error)) throw error;
      await waitBeforeRetry(attempt);
    }
  }
}

export async function withTransaction<Result>(
  callback: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await connectWithRetry();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Could not roll back PostgreSQL transaction:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
