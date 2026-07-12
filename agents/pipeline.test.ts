import test from "node:test";
import assert from "node:assert/strict";

import { closePool } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { buildProblemContext } from "./context-builder.js";
import {
  runSchemaAgent,
  runIntuitionAgent,
  runQueryBuilderAgent,
  runReviewerAgent,
  runFormatterAgent,
  runTeachingPipeline
} from "./pipeline.js";

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

    // Mock OpenRouter
    if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(options.body);
      const systemPrompt = body.messages[0].content;

      // Schema Agent
      if (systemPrompt.includes("SQL Schema Agent")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: "Schema: Person (personId, firstName, lastName), Address (addressId, personId, city, state)."
              }
            }]
          })
        } as any;
      }

      // Intuition Agent
      if (systemPrompt.includes("SQL Intuition Agent")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: "We need an outer join to keep person records even if they lack an address."
              }
            }]
          })
        } as any;
      }

      // Query Builder Agent
      if (systemPrompt.includes("SQL Query Builder")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: "SELECT p.firstName, p.lastName, a.city, a.state FROM Person p LEFT JOIN Address a ON p.personId = a.personId;"
              }
            }]
          })
        } as any;
      }

      // Reviewer Agent
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

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Fallback content" } }]
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

test("T3.1 Schema Agent returns structural details", async () => {
  const context = await buildProblemContext(175, "Combine Two Tables", "SELECT, Filtering & Joins", "test-pipeline-user");
  assert.ok(context);

  const schema = await runSchemaAgent(context);
  assert.ok(schema);
  assert.ok(schema.includes("Person"));
});

test("T3.2 Intuition Agent returns logical strategy", async () => {
  const context = await buildProblemContext(175, "Combine Two Tables", "SELECT, Filtering & Joins", "test-pipeline-user");
  assert.ok(context);

  const intuition = await runIntuitionAgent(context, "Mock Schema");
  assert.ok(intuition);
  assert.ok(intuition.includes("outer join"));
});

test("T3.3 Query Builder Agent generates postgres queries", async () => {
  const context = await buildProblemContext(175, "Combine Two Tables", "SELECT, Filtering & Joins", "test-pipeline-user");
  assert.ok(context);

  const queryText = await runQueryBuilderAgent(context, "Mock Schema", "Mock Intuition");
  assert.ok(queryText);
  assert.ok(queryText.includes("LEFT JOIN"));
});

test("T3.9 Reviewer Agent parses JSON validations correctly", async () => {
  const sampleQuery = "SELECT p.firstName FROM Person p;";
  const review = await runReviewerAgent(sampleQuery);
  
  assert.ok(review);
  assert.equal(review.valid, true);
  assert.equal(review.issues, "");
});

test("T3.11 Full pipeline wiring completes end-to-end", async () => {
  const context = await buildProblemContext(175, "Combine Two Tables", "SELECT, Filtering & Joins", "test-pipeline-user");
  assert.ok(context);

  const result = await runTeachingPipeline(context);

  assert.ok(result);
  assert.ok(result.lesson_markdown.length > 50);
  assert.equal(result.teaching_score, 10.0);
  assert.ok(result.formatted_json.includes("parent_message"));
});
