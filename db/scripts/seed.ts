import { closePool, query } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";
import { seedMockLessons } from "../src/seed.js";

try {
  await runMigrations();
  const insertedCount = await seedMockLessons();
  const { rows } = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM user_lessons");

  console.log(`Seeded ${insertedCount} mock user lesson records.`);
  console.log(`Database currently contains ${rows[0].count} user lessons.`);
} finally {
  await closePool();
}
