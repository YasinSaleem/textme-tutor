import { closePool } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";

try {
  const ran = await runMigrations();

  if (ran.length === 0) {
    console.log("No new migrations to apply.");
  } else {
    console.log(`Applied migrations: ${ran.join(", ")}`);
  }
} finally {
  await closePool();
}

