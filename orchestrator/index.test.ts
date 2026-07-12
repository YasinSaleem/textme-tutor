import test from "node:test";
import assert from "node:assert/strict";

import { closePool, query } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { createUserLesson, getPendingLesson } from "../db/src/repository.js";
import { runOrchestrator } from "./index.js";

async function clearLessonsTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

test.before(async () => {
  process.env.NODE_ENV = "test";
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_CHANNEL_ID = "C-TEST";
  process.env.USER_ID = "test-orchestrator-user";
  
  await runMigrations();
});

test.after(async () => {
  await closePool();
});

test("Orchestrator process A handles new selection, Slack publishing, and DB write successfully", async () => {
  await clearLessonsTable();

  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async (url: any, options: any) => {
    const urlStr = String(url);
    
    // Slack postMessage mock
    if (urlStr.includes("slack.com/api/chat.postMessage")) {
      return {
        ok: true,
        text: async () => "ok",
        json: async () => ({ ok: true, ts: "slack-ts-999" })
      } as any;
    }
    
    // LeetCode GraphQL mock
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
            },
            problemsetQuestionList: {
              questions: [
                {
                  questionId: "175",
                  title: "Combine Two Tables",
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
    
    // Mock OpenRouter
    if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(options.body);
      const systemPrompt = body.messages[0].content;
      
      // If SQL Curriculum Selector Agent call
      if (systemPrompt.includes("SQL Curriculum Selector")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  selected_id: 175,
                  selected_title: "Combine Two Tables"
                })
              }
            }]
          })
        } as any;
      }
      
      // If Reviewer Agent call
      if (systemPrompt.includes("Reviewer")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  valid: true,
                  issues: "",
                  suggested_fixes: ""
                })
              }
            }]
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
            }]
          })
        } as any;
      }

      // Generic agent response (teaching pipeline)
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "### Mocked Agent Output showing SQL details."
            }
          }]
        })
      } as any;
    }
    
    return originalFetch(url, options);
  };

  try {
    await runOrchestrator();

    const pending = await getPendingLesson("test-orchestrator-user");
    assert.ok(pending);
    assert.equal(pending.problem_title, "Combine Two Tables");
    assert.equal(pending.slack_message_ts, "slack-ts-999");
    assert.equal(pending.status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Orchestrator failure handling: if Slack publishing fails, database is not updated", async () => {
  await clearLessonsTable();

  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async (url: any, options: any) => {
    const urlStr = String(url);
    
    // Slack postMessage mock -> FAIL!
    if (urlStr.includes("slack.com/api/chat.postMessage")) {
      return {
        ok: true,
        json: async () => ({ ok: false, error: "invalid_auth" })
      } as any;
    }
    
    // LeetCode GraphQL mock
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
            },
            problemsetQuestionList: {
              questions: [
                {
                  questionId: "175",
                  title: "Combine Two Tables",
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
    
    // OpenRouter mock
    if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(options.body);
      const systemPrompt = body.messages[0].content;

      // If SQL Curriculum Selector Agent call
      if (systemPrompt.includes("SQL Curriculum Selector")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  selected_id: 175,
                  selected_title: "Combine Two Tables"
                })
              }
            }]
          })
        } as any;
      }

      // If Reviewer Agent call
      if (systemPrompt.includes("Reviewer")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  valid: true,
                  issues: "",
                  suggested_fixes: ""
                })
              }
            }]
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
            }]
          })
        } as any;
      }

      // Generic pipeline
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "### Mocked Pipeline Content"
            }
          }]
        })
      } as any;
    }
    
    return originalFetch(url, options);
  };

  try {
    await assert.rejects(async () => {
      await runOrchestrator();
    }, /Slack API error: invalid_auth/);

    const pending = await getPendingLesson("test-orchestrator-user");
    assert.equal(pending, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
