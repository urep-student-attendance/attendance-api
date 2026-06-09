import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { getConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveMigrationsDir() {
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(__dirname, "..", "migrations"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not find migrations directory. Tried: ${candidates.join(", ")}`);
}

async function main() {
  const client = new Client({ connectionString: getConfig().databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query("COMMIT");

    const migrationsDir = await resolveMigrationsDir();
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [file],
      );

      if (alreadyApplied.rowCount) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
