import fs from "node:fs/promises";
import path from "node:path";
import { isTransientConnectionFailure, pool } from "./index";

const schemaPath = path.resolve(__dirname, "schema.sql");

export async function applySchema(): Promise<void> {
  const schema = await fs.readFile(schemaPath, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query(schema);
      return;
    } catch (error) {
      // The schema script uses idempotent CREATE/ALTER statements, so a
      // connection lost during Supabase wake-up can safely retry the setup.
      if (attempt >= 2 || !isTransientConnectionFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
