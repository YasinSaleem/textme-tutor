import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

import { closePool, query } from "../db/src/client.js";
import { runMigrations } from "../db/src/migrations.js";
import { createUserLesson, getLessonByTs } from "../db/src/repository.js";
import {
  verifySlackSignature,
  parseUserIntent,
  handleThreadReply,
  createListenerServer
} from "./listener.js";

async function clearLessonsTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

test.before(async () => {
  process.env.NODE_ENV = "test";
  process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  
  await runMigrations();
});

test.after(async () => {
  await closePool();
});

test("verifySlackSignature verifies valid request signatures", () => {
  const secret = "test-signing-secret";
  const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(baseString);
  const signature = `v0=${hmac.digest("hex")}`;

  const isValid = verifySlackSignature(secret, body, timestamp, signature);
  assert.equal(isValid, true);

  const isInvalid = verifySlackSignature(secret, body, timestamp, "v0=wrongsignature");
  assert.equal(isInvalid, false);
});

test("parseUserIntent classifies user phrases correctly", async () => {
  const intent1 = await parseUserIntent("Yes I got it! Makes perfect sense.");
  assert.equal(intent1, "understood");

  const intent2 = await parseUserIntent("No, it was too vague. Explain again.");
  assert.equal(intent2, "not_understood");

  const intent3 = await parseUserIntent("Wait, why did we use a LEFT JOIN instead of an INNER JOIN?");
  assert.equal(intent3, "conversational");
});

test("handleThreadReply transitions database states correctly based on intent", async () => {
  await clearLessonsTable();

  // Create a pending lesson
  const threadTs = "ts-thread-111";
  await createUserLesson({
    userId: "test-user-b",
    leetcodeId: 175,
    problemTitle: "Combine Two Tables",
    normalizedProblemTitle: "combine two tables",
    topic: "SELECT, Filtering & Joins",
    difficulty: "Easy",
    lessonMarkdown: "Initial lesson text",
    status: "pending",
    slackChannelId: "C1",
    slackMessageTs: threadTs
  });

  // Mock global fetch to intercept publishing reply
  const originalFetch = globalThis.fetch;
  let postedReplies: any[] = [];
  globalThis.fetch = async (url: any, options: any) => {
    if (String(url).includes("slack.com/api/chat.postMessage")) {
      postedReplies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ ok: true, ts: "ts-reply" })
      } as any;
    }
    return originalFetch(url, options);
  };

  try {
    // 1. Understood intent
    await handleThreadReply("C1", threadTs, "I understood!", "understood");
    
    const lessonUnderstood = await getLessonByTs(threadTs);
    assert.ok(lessonUnderstood);
    assert.equal(lessonUnderstood.status, "understood");
    assert.equal(postedReplies.length, 1);
    assert.match(postedReplies[0].text, /marked this problem as understood/i);

    // Reset status to pending
    await query("UPDATE user_lessons SET status = 'pending' WHERE slack_message_ts = $1", [threadTs]);

    // 2. Not Understood / Vague intent
    await handleThreadReply("C1", threadTs, "It was vague", "not_understood");
    
    const lessonVague = await getLessonByTs(threadTs);
    assert.ok(lessonVague);
    assert.equal(lessonVague.status, "vague");
    assert.equal(postedReplies.length, 2);
    assert.match(postedReplies[1].text, /marked this explanation as vague/i);

    // Reset status to pending
    await query("UPDATE user_lessons SET status = 'pending' WHERE slack_message_ts = $1", [threadTs]);

    // 3. Conversational intent
    await handleThreadReply("C1", threadTs, "Why O(N)?", "conversational", "Mocked conversational response");
    
    const lessonConv = await getLessonByTs(threadTs);
    assert.ok(lessonConv);
    assert.equal(lessonConv.status, "pending"); // remains pending!
    assert.equal(postedReplies.length, 3);
    assert.equal(postedReplies[2].text, "Mocked conversational response");

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Listener server handles Slack webhook challenge challenge verification", async () => {
  const server = createListenerServer();
  
  // Start server on a random ephemeral port
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;

  try {
    const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token-123" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Generate valid header signatures
    const baseString = `v0:${timestamp}:${payload}`;
    const hmac = crypto.createHmac("sha256", "test-signing-secret");
    hmac.update(baseString);
    const signature = `v0=${hmac.digest("hex")}`;

    const res = await fetch(`http://localhost:${port}`, {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
        "Content-Type": "application/json"
      },
      body: payload
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.challenge, "challenge-token-123");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
