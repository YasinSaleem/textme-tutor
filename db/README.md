# Database

Phase 1 uses plain SQL migrations and a thin TypeScript repository layer on top of Postgres.

## Commands

```bash
npm run db:migrate
npm run db:seed
npm run db:test
```

## Notes

- `lessons.problem_id` uses `ON DELETE RESTRICT` so we do not lose lesson history by accidentally deleting a problem.
- Seed data lives in [`db/seeds/problems.json`](/Users/yasinsaleem/Programming/Personal%20Projects/textme-tutor/db/seeds/problems.json) and is idempotent via `ON CONFLICT (leetcode_id)`.
- Tests run against the configured `DATABASE_URL`, so they truncate project tables before exercising the repository layer.
