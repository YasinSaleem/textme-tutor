import test from "node:test";
import assert from "node:assert/strict";

import { closePool, query } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { createUserLesson } from "../db/src/repository.js";
import {
  determineActiveTopicAndDifficulty,
  TopicProgressSummary
} from "./curriculum.js";
import {
  matchesTopic,
  normalizeTitle,
  resolveTodaysProblem
} from "./priority-resolver.js";

async function clearLessonsTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

let originalFetch: typeof globalThis.fetch;

test.before(async () => {
  await runMigrations();
  originalFetch = globalThis.fetch;

  globalThis.fetch = async (url: any, options: any) => {
    const urlStr = String(url);

    // Mock LeetCode GraphQL
    if (urlStr.includes("leetcode.com/graphql")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            question: {
              questionId: "175",
              title: "Combine Two Tables",
              content: "<p>Table: Person...</p>",
              difficulty: "Easy",
              topicTags: [{ name: "Database" }]
            }
          }
        })
      } as any;
    }

    // Mock OpenRouter Problem Selection
    if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                candidates: [
                  { leetcode_id: 175, problem_title: "Combine Two Tables" }
                ]
              })
            }
          }]
        })
      } as any;
    }

    return originalFetch(url, options);
  };
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await closePool();
});

test("determineActiveTopicAndDifficulty calculates correct topic and difficulty progression", () => {
  // 1. Progress is empty -> should return SELECT, Filtering & Joins Easy
  const active1 = determineActiveTopicAndDifficulty([]);
  assert.ok(active1);
  assert.equal(active1.topic, "SELECT, Filtering & Joins");
  assert.equal(active1.difficulty, "Easy");

  // 2. SELECT, Filtering & Joins has 5 Easy (target is 10) -> remains SELECT, Filtering & Joins Easy
  const progress2: TopicProgressSummary[] = [
    { topic: "SELECT, Filtering & Joins", difficulty: "Easy", understood_count: 5 }
  ];
  const active2 = determineActiveTopicAndDifficulty(progress2);
  assert.ok(active2);
  assert.equal(active2.topic, "SELECT, Filtering & Joins");
  assert.equal(active2.difficulty, "Easy");

  // 3. SELECT, Filtering & Joins has 10 Easy -> moves to Aggregation & Group By Medium (target 8)
  const progress3: TopicProgressSummary[] = [
    { topic: "SELECT, Filtering & Joins", difficulty: "Easy", understood_count: 10 }
  ];
  const active3 = determineActiveTopicAndDifficulty(progress3);
  assert.ok(active3);
  assert.equal(active3.topic, "Aggregation & Group By");
  assert.equal(active3.difficulty, "Medium");

  // 4. Aggregation & Group By has 8 Medium -> moves to Subqueries & CTEs Medium
  const progress4: TopicProgressSummary[] = [
    { topic: "SELECT, Filtering & Joins", difficulty: "Easy", understood_count: 10 },
    { topic: "Aggregation & Group By", difficulty: "Medium", understood_count: 8 }
  ];
  const active4 = determineActiveTopicAndDifficulty(progress4);
  assert.ok(active4);
  assert.equal(active4.topic, "Subqueries & CTEs");
  assert.equal(active4.difficulty, "Medium");
});

test("normalizeTitle correctly collapses whitespace and trims", () => {
  assert.equal(normalizeTitle("  Combine   Two   Tables  "), "combine two tables");
  assert.equal(normalizeTitle("POW(X, N)"), "pow(x, n)");
});

test("matchesTopic correctly checks synonyms and variations", () => {
  // Database matching (SQL Category)
  assert.equal(matchesTopic(["Database", "SQL"], "SELECT, Filtering & Joins"), true);
  assert.equal(matchesTopic(["Join", "Database"], "SELECT, Filtering & Joins"), true);
  // Negative case (should match because tags have "Database" or related tags, otherwise falls back)
  assert.equal(matchesTopic(["Array"], "SELECT, Filtering & Joins"), false);
});

test("resolveTodaysProblem Priority 1 returns pending lesson", async () => {
  await clearLessonsTable();

  await createUserLesson({
    userId: "priority-user",
    leetcodeId: 175,
    problemTitle: "Combine Two Tables",
    normalizedProblemTitle: "combine two tables",
    topic: "SELECT, Filtering & Joins",
    difficulty: "Easy",
    lessonMarkdown: "Pending lesson text",
    status: "pending",
    slackChannelId: "C1",
    slackMessageTs: "ts-pending"
  });

  const decision = await resolveTodaysProblem("priority-user", 3);
  assert.equal(decision.type, "pending");
  assert.equal(decision.leetcode_id, 175);
  assert.equal(decision.problem_title, "Combine Two Tables");
  assert.equal(decision.lesson_markdown, "Pending lesson text");
});

test("resolveTodaysProblem Priority 2 returns vague lesson due for resend", async () => {
  await clearLessonsTable();

  // Vague due (5 days ago, interval is 3)
  await createUserLesson({
    userId: "priority-user",
    leetcodeId: 180,
    problemTitle: "Consecutive Numbers",
    normalizedProblemTitle: "consecutive numbers",
    topic: "Window Functions",
    difficulty: "Medium",
    lessonMarkdown: "Vague lesson text",
    lessonVersion: 2,
    status: "vague",
    slackChannelId: "C1",
    slackMessageTs: "ts-vague",
    respondedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
  });

  const decision = await resolveTodaysProblem("priority-user", 3);
  assert.equal(decision.type, "vague_resend");
  assert.equal(decision.leetcode_id, 180);
  assert.equal(decision.lesson_version, 3); // incremented version
  assert.equal(decision.slack_channel_id, "C1");
});

test("resolveTodaysProblem Priority 3 selects a unique, validated new problem", async () => {
  await clearLessonsTable();

  // Progress is empty -> should target SELECT, Filtering & Joins Easy
  const decision = await resolveTodaysProblem("priority-user", 3);
  
  assert.equal(decision.type, "new_selection");
  assert.equal(decision.topic, "SELECT, Filtering & Joins");
  assert.equal(decision.difficulty, "Easy");
  assert.ok(decision.leetcode_id > 0);
  assert.ok(decision.problem_title.length > 0);
});
