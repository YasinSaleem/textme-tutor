import test from "node:test";
import assert from "node:assert/strict";

import { closePool, query } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { createUserLesson } from "../db/src/repository.js";
import {
  buildProblemContext,
  getSlug,
  parseLeetCodeHTML
} from "./context-builder.js";

async function clearLessonsTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

test.before(async () => {
  await runMigrations();
});

test.after(async () => {
  await closePool();
});

test("getSlug correctly handles titles", () => {
  assert.equal(getSlug("Combine Two Tables"), "combine-two-tables");
  assert.equal(getSlug("Pow(x, n)"), "powx-n");
  assert.equal(getSlug("Container With Most Water"), "container-with-most-water");
  assert.equal(getSlug("  Space  and-hyphen  "), "space-and-hyphen");
});

test("parseLeetCodeHTML correctly extracts statement, constraints, examples", () => {
  const sampleHTML = `
    <p>Given a table, find columns.</p>
    <strong class="example">Example 1:</strong>
    <pre>
    Input: personId = 1
    Output: None
    </pre>
    <p><strong>Constraints:</strong></p>
    <ul>
      <li><code>personId is primary key</code></li>
    </ul>
  `;

  const parsed = parseLeetCodeHTML(sampleHTML);

  assert.equal(parsed.statement, "Given a table, find columns.");
  assert.deepEqual(parsed.examples, ['Input: personId = 1\n    Output: None']);
  assert.equal(parsed.constraints, "- personId is primary key");
});

test("buildProblemContext fetches from LeetCode GraphQL and retrieves DB progress", async () => {
  await clearLessonsTable();

  // Clear and seed dynamic progress in DB
  await createUserLesson({
    userId: "test-builder-user",
    leetcodeId: 175,
    problemTitle: "Combine Two Tables",
    normalizedProblemTitle: "combine two tables",
    topic: "SELECT, Filtering & Joins",
    difficulty: "Easy",
    lessonMarkdown: "mock content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-context-test"
  });

  const context = await buildProblemContext(175, "Combine Two Tables", "SELECT, Filtering & Joins", "test-builder-user");

  assert.ok(context);
  assert.equal(context.leetcode_id, 175);
  assert.equal(context.problem_title, "Combine Two Tables");
  assert.equal(context.difficulty, "Easy");
  assert.match(context.statement, /Person/i);
  assert.ok(context.examples.length > 0);
  assert.ok(context.tags.includes("Database"));
});
