import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withClient } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../migrations");

type AppliedMigrationRow = {
  version: string;
};

export async function runMigrations(): Promise<string[]> {
  const filenames = (await readdir(migrationsDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  return withClient(async (client) => {
    await client.query("BEGIN");

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const { rows } = await client.query<AppliedMigrationRow>(
        "SELECT version FROM schema_migrations"
      );
      const applied = new Set(rows.map((row) => row.version));
      const ran: string[] = [];

      for (const filename of filenames) {
        if (applied.has(filename)) {
          continue;
        }

        const sql = await readFile(path.join(migrationsDir, filename), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [filename]);
        ran.push(filename);
      }

      await client.query("COMMIT");
      return ran;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

