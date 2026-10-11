const fs = require("node:fs/promises");
const path = require("node:path");
const { env } = require("./config/env");
const { pool } = require("./database");
const { applySchema } = require("./database/migrate");

async function seed() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL.");
  }

  await applySchema(pool);
  const catalogueSql = await fs.readFile(path.join(__dirname, "database", "seed.sql"), "utf8");
  await pool.query(catalogueSql);

  const { rows } = await pool.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE active AND fleet_status = 'available')::int AS available FROM cars",
  );
  console.log(`Vehicle catalogue synchronized: ${rows[0].total} total, ${rows[0].available} available.`);
}

seed()
  .catch((error) => {
    console.error("Could not seed the vehicle catalogue:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
