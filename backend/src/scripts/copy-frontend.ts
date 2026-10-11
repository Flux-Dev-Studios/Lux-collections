import fs from "node:fs/promises";
import path from "node:path";

const sourceDirectory = path.resolve(__dirname, "../../../frontend");
const outputDirectory = path.resolve(sourceDirectory, "dist");
const assetsDirectory = path.join(outputDirectory, "assets");
const backendSchema = path.resolve(__dirname, "../../src/database/schema.sql");
const backendSeed = path.resolve(__dirname, "../../src/database/seed.sql");
const compiledSchema = path.resolve(__dirname, "../database/schema.sql");
const compiledSeed = path.resolve(__dirname, "../database/seed.sql");

async function copyFrontend(): Promise<void> {
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const entry of await fs.readdir(sourceDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(html|css)$/.test(entry.name)) {
      await fs.copyFile(path.join(sourceDirectory, entry.name), path.join(outputDirectory, entry.name));
    }
  }

  for (const entry of await fs.readdir(assetsDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      await fs.copyFile(path.join(assetsDirectory, entry.name), path.join(outputDirectory, entry.name));
    }
  }
  await fs.mkdir(path.dirname(compiledSchema), { recursive: true });
  await fs.copyFile(backendSchema, compiledSchema);
  await fs.copyFile(backendSeed, compiledSeed);
}

copyFrontend().catch((error: unknown) => {
  console.error("Could not prepare the frontend for production:", error);
  process.exitCode = 1;
});
