const { env } = require("../config/env");
const { databaseUrl } = env;
const { pool } = require("../database");
const { applySchema } = require("../database/migrate");

async function migrate() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL.");
  }

  await applySchema(pool);
  console.log("PostgreSQL schema is ready.");
}

migrate()
  .catch((error) => {
    console.error("Could not apply the PostgreSQL schema:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
