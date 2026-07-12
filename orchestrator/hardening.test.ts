import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { closePool, query } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { createUserLesson, getLessonByTs, getPendingLesson } from "../db/src/repository.js";
import { runOrchestrator } from "./index.js";
import { handleThreadReply } from "../slack/listener.js";

async function clearLessonsTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

test.before(async () => {
  process.env.NODE_ENV = "test";
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_CHANNEL_ID = "C-TEST";
  process.env.USER_ID = "hardening-user";

  await runMigrations();
});

test.after(async () => {
  await closePool();
});

test("T9.1 & T9.3 End-to-end day-cycle progression and token logging", async () => {
  await clearLessonsTable();

  const logFile = "./logs/token-usage.jsonl";
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  const originalFetch = globalThis.fetch;
  let postedReplies: any[] = [];
  let selectionCallCount = 0;
  let parentMessageCount = 0;

  globalThis.fetch = async (url: any, options: any) => {
    const urlStr = String(url);

    // Slack postMessage mock
    if (urlStr.includes("slack.com/api/chat.postMessage")) {
      const parsed = JSON.parse(options.body);
      postedReplies.push(parsed);
      if (parsed.thread_ts) {
        return {
          ok: true,
          json: async () => ({ ok: true, ts: "ts-reply" })
        } as any;
      }
      parentMessageCount++;
      const parentTs = parentMessageCount === 1 ? "ts-parent-1" : "ts-parent-2";
      return {
        ok: true,
        json: async () => ({ ok: true, ts: parentTs })
      } as any;
    }

    // LeetCode GraphQL mock
    if (urlStr.includes("leetcode.com/graphql")) {
      const parsedBody = JSON.parse(options.body);
      
      // If asking for a list of questions (problem discovery)
      if (parsedBody.query.includes("problemsetQuestionList")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              problemsetQuestionList: {
                questions: [
                  {
                    questionId: "175",
                    title: "Combine Two Tables",
                    difficulty: "Easy",
                    isPaidOnly: false,
                    topicTags: [{ name: "Database" }]
                  },
                  {
                    questionId: "181",
                    title: "Employees Earning More Than Their Managers",
                    difficulty: "Easy",
                    isPaidOnly: false,
                    topicTags: [{ name: "Database" }]
                  }
                ]
              }
            }
          })
        } as any;
      }

      // If resolving problem content
      const slug = parsedBody.variables.titleSlug;
      const title = slug === "combine-two-tables" ? "Combine Two Tables" : "Employees Earning More Than Their Managers";
      const id = slug === "combine-two-tables" ? 175 : 181;
      return {
        ok: true,
        json: async () => ({
          data: {
            question: {
              questionId: String(id),
              title: title,
              content: "<p>Table: Person...</p>",
              difficulty: "Easy",
              topicTags: [{ name: "Database" }]
            }
          }
        })
      } as any;
    }

    // OpenRouter mock
    if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(options.body);
      const systemPrompt = body.messages[0].content;

      // SQL Curriculum Selector
      if (systemPrompt.includes("SQL Curriculum Selector")) {
        selectionCallCount++;
        const selected_id = selectionCallCount === 1 ? 175 : 181;
        const selected_title = selectionCallCount === 1 
          ? "Combine Two Tables" 
          : "Employees Earning More Than Their Managers";

        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ selected_id, selected_title }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          })
        } as any;
      }

      // Reviewer
      if (systemPrompt.includes("Reviewer")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ valid: true, issues: "", suggested_fixes: "" }) } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
          })
        } as any;
      }

      // Formatter Agent
      if (systemPrompt.includes("Slack Formatter")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  parent_message: "Introduction to Combine Two Tables",
                  replies: [
                    "*Core Intuition*\nUse LEFT JOIN.",
                    "*Step-by-Step Query Construction*\nJoin ON personId.",
                    "*PostgreSQL Query*\n```sql\nSELECT ...\n```",
                    "*Expected Output & Standardized Edge Cases*\n- Expected Output:\n```text\n+------+------+\n| col1 | col2 |\n+------+------+\n```\n- Edge Cases:\n  • NULL values: ..."
                  ]
                })
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 15, total_tokens: 30 }
          })
        } as any;
      }

      // Other pipeline agents (Schema, Intuition, QueryBuilder)
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "### Mocked walkthrough text" } }],
          usage: { prompt_tokens: 15, completion_tokens: 15, total_tokens: 30 }
        })
      } as any;
    }

    return originalFetch(url, options);
  };

  try {
    // --- DAY 1 ---
    console.log("--- Simulating Day 1: Run Orchestrator ---");
    await runOrchestrator();

    const lessonDay1 = await getPendingLesson("hardening-user");
    assert.ok(lessonDay1);
    assert.equal(lessonDay1.problem_title, "Combine Two Tables");
    assert.equal(lessonDay1.slack_message_ts, "ts-parent-1");
    assert.equal(lessonDay1.status, "pending");

    // --- USER REPLY ---
    console.log("--- Simulating Day 1 User Reply: Understood ---");
    await handleThreadReply("C-TEST", "ts-parent-1", "Got it, clear!", "understood");

    const updatedLesson = await getLessonByTs("ts-parent-1");
    assert.ok(updatedLesson);
    assert.equal(updatedLesson.status, "understood");

    // --- DAY 2 ---
    console.log("--- Simulating Day 2: Run Orchestrator (Should skip Combine Two Tables) ---");
    await runOrchestrator();

    const lessonDay2 = await getPendingLesson("hardening-user");
    assert.ok(lessonDay2);
    assert.equal(lessonDay2.problem_title, "Employees Earning More Than Their Managers");
    assert.equal(lessonDay2.slack_message_ts, "ts-parent-2");
    assert.equal(lessonDay2.status, "pending");

    // --- T9.3: Verify Token Logs ---
    console.log("--- Verifying T9.3 Token/Cost Logs ---");
    assert.equal(fs.existsSync(logFile), true);
    const logContent = fs.readFileSync(logFile, "utf8");
    assert.match(logContent, /"total_tokens":15/);
    assert.match(logContent, /"total_tokens":30/);
    console.log("Token logs content check passed successfully.");

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T9.2 Late-reply idempotency isolation", async () => {
  await clearLessonsTable();

  // Seed older lesson
  await createUserLesson({
    userId: "hardening-user",
    leetcodeId: 176,
    problemTitle: "Second Highest Salary",
    normalizedProblemTitle: "second highest salary",
    topic: "Subqueries & CTEs",
    difficulty: "Medium",
    lessonMarkdown: "Old lesson content",
    status: "pending",
    slackChannelId: "C-TEST",
    slackMessageTs: "ts-old"
  });

  // Seed newer lesson
  await createUserLesson({
    userId: "hardening-user",
    leetcodeId: 178,
    problemTitle: "Rank Scores",
    normalizedProblemTitle: "rank scores",
    topic: "Window Functions",
    difficulty: "Medium",
    lessonMarkdown: "New lesson content",
    status: "pending",
    slackChannelId: "C-TEST",
    slackMessageTs: "ts-new"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, options: any) => {
    return {
      ok: true,
      json: async () => ({ ok: true, ts: "ts-reply" })
    } as any;
  };

  try {
    // Late reply on the older thread "ts-old"
    console.log("--- Simulating late thread reply on ts-old ---");
    await handleThreadReply("C-TEST", "ts-old", "I understood this finally!", "understood");

    // Check states:
    // Older lesson must become 'understood'
    const oldLesson = await getLessonByTs("ts-old");
    assert.ok(oldLesson);
    assert.equal(oldLesson.status, "understood");

    // Newer lesson MUST remain 'pending' (completely untouched and uncorrupted!)
    const newLesson = await getLessonByTs("ts-new");
    assert.ok(newLesson);
    assert.equal(newLesson.status, "pending");
    console.log("Late-reply idempotency checks passed successfully.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
