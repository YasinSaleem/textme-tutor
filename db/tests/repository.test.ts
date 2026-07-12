import test from "node:test";
import assert from "node:assert/strict";

import { closePool, query } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";
import {
  createUserLesson,
  getDueVagueLesson,
  getPendingLesson,
  getTopicProgress,
  hasProblemBeenSeen,
  updateUserLessonStatus,
  getResponseLatency,
  getVagueTrendByTopic,
  getUnderstoodStreak
} from "../src/repository.js";
import { seedMockLessons } from "../src/seed.js";

async function resetTable(): Promise<void> {
  await query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");
}

async function expectQueryFailure(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
    assert.fail("Expected query to fail.");
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
}

test.before(async () => {
  await runMigrations();
});

test.after(async () => {
  await closePool();
});

test("T1.1 user_lessons table inserts and reads a single lesson", async () => {
  await resetTable();

  const lesson = await createUserLesson({
    userId: "user-1",
    leetcodeId: 100,
    problemTitle: "Same Title",
    normalizedProblemTitle: "same title",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "Some markdown text here",
    lessonVersion: 1,
    teachingScore: 9.2,
    status: "pending",
    slackChannelId: "C123",
    slackMessageTs: "ts-100"
  });

  assert.equal(lesson.user_id, "user-1");
  assert.equal(lesson.problem_title, "Same Title");
  assert.equal(lesson.leetcode_id, 100);
  assert.equal(lesson.difficulty, "Easy");
  assert.equal(lesson.status, "pending");
  assert.equal(lesson.teaching_score, "9.20"); // NUMERIC(4,2) returns padded string in pg
});

test("T1.1 user_lessons check constraints reject invalid status value", async () => {
  await resetTable();

  const error = await expectQueryFailure(() =>
    createUserLesson({
      userId: "user-invalid",
      leetcodeId: 101,
      problemTitle: "Invalid Status Title",
      normalizedProblemTitle: "invalid status title",
      topic: "Arrays",
      difficulty: "Easy",
      lessonMarkdown: "content",
      status: "mystery" as any, // invalid status
      slackChannelId: "C123",
      slackMessageTs: "ts-invalid"
    })
  );

  assert.match(error.message, /violates check constraint/i);
});

test("T1.1 user_lessons enforces unique slack_message_ts", async () => {
  await resetTable();

  await createUserLesson({
    userId: "user-1",
    leetcodeId: 102,
    problemTitle: "Unique TS 1",
    normalizedProblemTitle: "unique ts 1",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    slackChannelId: "C123",
    slackMessageTs: "duplicate-ts"
  });

  const error = await expectQueryFailure(() =>
    createUserLesson({
      userId: "user-2",
      leetcodeId: 103,
      problemTitle: "Unique TS 2",
      normalizedProblemTitle: "unique ts 2",
      topic: "Arrays",
      difficulty: "Easy",
      lessonMarkdown: "content",
      slackChannelId: "C123",
      slackMessageTs: "duplicate-ts" // duplicate
    })
  );

  assert.match(error.message, /duplicate key value/i);
});

test("T1.3 getPendingLesson returns the oldest pending lesson", async () => {
  await resetTable();

  await createUserLesson({
    userId: "pending-user",
    leetcodeId: 104,
    problemTitle: "Pending newer",
    normalizedProblemTitle: "pending newer",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    slackChannelId: "C123",
    slackMessageTs: "ts-newer",
    sentAt: new Date("2026-07-08T09:00:00.000Z")
  });

  await createUserLesson({
    userId: "pending-user",
    leetcodeId: 105,
    problemTitle: "Pending older",
    normalizedProblemTitle: "pending older",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    slackChannelId: "C123",
    slackMessageTs: "ts-older",
    sentAt: new Date("2026-07-07T09:00:00.000Z")
  });

  const pending = await getPendingLesson("pending-user");
  assert.ok(pending);
  assert.equal(pending.slack_message_ts, "ts-older");
  assert.equal(pending.problem_title, "Pending older");
});

test("T1.3 getDueVagueLesson returns only vague rows outside the resend interval", async () => {
  await resetTable();

  // Vague lesson inside the interval (1 day ago, interval is 3 days)
  await createUserLesson({
    userId: "vague-user",
    leetcodeId: 106,
    problemTitle: "Vague inside",
    normalizedProblemTitle: "vague inside",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C123",
    slackMessageTs: "ts-inside",
    respondedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
  });

  // Vague lesson outside the interval (5 days ago, interval is 3 days)
  await createUserLesson({
    userId: "vague-user",
    leetcodeId: 107,
    problemTitle: "Vague due",
    normalizedProblemTitle: "vague due",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C123",
    slackMessageTs: "ts-due",
    respondedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
  });

  const due = await getDueVagueLesson("vague-user", 3);
  assert.ok(due);
  assert.equal(due.slack_message_ts, "ts-due");
});

test("T1.3 updateUserLessonStatus resolves pending and sets responded_at", async () => {
  await resetTable();

  await createUserLesson({
    userId: "user-resolve",
    leetcodeId: 108,
    problemTitle: "Pending resolve",
    normalizedProblemTitle: "pending resolve",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "pending",
    slackChannelId: "C123",
    slackMessageTs: "ts-resolve"
  });

  const updated = await updateUserLessonStatus("ts-resolve", "understood");
  assert.ok(updated);
  assert.equal(updated.status, "understood");
  assert.ok(updated.responded_at instanceof Date);
});

test("T1.3 getTopicProgress groups and counts understood lessons", async () => {
  await resetTable();

  // Seed 2 understood Arrays Easy
  await createUserLesson({
    userId: "progress-user",
    leetcodeId: 201,
    problemTitle: "P1",
    normalizedProblemTitle: "p1",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-p1"
  });
  await createUserLesson({
    userId: "progress-user",
    leetcodeId: 202,
    problemTitle: "P2",
    normalizedProblemTitle: "p2",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-p2"
  });

  // Seed 1 understood Arrays Medium
  await createUserLesson({
    userId: "progress-user",
    leetcodeId: 203,
    problemTitle: "P3",
    normalizedProblemTitle: "p3",
    topic: "Arrays",
    difficulty: "Medium",
    lessonMarkdown: "content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-p3"
  });

  // Seed 1 vague Hash Maps Easy (should not be counted in understood progress)
  await createUserLesson({
    userId: "progress-user",
    leetcodeId: 204,
    problemTitle: "P4",
    normalizedProblemTitle: "p4",
    topic: "Hash Maps",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C1",
    slackMessageTs: "ts-p4"
  });

  const progress = await getTopicProgress("progress-user");
  assert.equal(progress.length, 2);

  const arraysEasy = progress.find(p => p.topic === "Arrays" && p.difficulty === "Easy");
  const arraysMed = progress.find(p => p.topic === "Arrays" && p.difficulty === "Medium");
  
  assert.ok(arraysEasy);
  assert.equal(arraysEasy.understood_count, 2);
  assert.ok(arraysMed);
  assert.equal(arraysMed.understood_count, 1);
});

test("T1.3 hasProblemBeenSeen returns correct boolean on title or ID matches", async () => {
  await resetTable();

  await createUserLesson({
    userId: "check-user",
    leetcodeId: 50,
    problemTitle: "Pow x n",
    normalizedProblemTitle: "pow x n",
    topic: "Binary Search",
    difficulty: "Medium",
    lessonMarkdown: "content",
    slackChannelId: "C1",
    slackMessageTs: "ts-check"
  });

  // ID matches
  const matchId = await hasProblemBeenSeen(50, "different title", "check-user");
  // Title matches
  const matchTitle = await hasProblemBeenSeen(999, "pow x n", "check-user");
  // No match
  const noMatch = await hasProblemBeenSeen(999, "different title", "check-user");
  // Other user's match (should return false because check is per user)
  const matchOtherUser = await hasProblemBeenSeen(50, "pow x n", "different-user");

  assert.equal(matchId, true);
  assert.equal(matchTitle, true);
  assert.equal(noMatch, false);
  assert.equal(matchOtherUser, false);
});

test("T1.2 seedMockLessons loads mock lessons successfully", async () => {
  const seededCount = await seedMockLessons();
  assert.equal(seededCount, 8);

  const { rows } = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM user_lessons");
  assert.equal(rows[0].count, "8");
});

test("T8.1 getResponseLatency calculates correct avg and median seconds", async () => {
  await resetTable();

  const sent = new Date("2026-07-09T10:00:00Z");
  
  // Lesson 1: 10 mins latency (600s)
  await createUserLesson({
    userId: "latency-user",
    leetcodeId: 1,
    problemTitle: "P1",
    normalizedProblemTitle: "p1",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-1",
    sentAt: sent,
    respondedAt: new Date(sent.getTime() + 10 * 60 * 1000)
  });

  // Lesson 2: 20 mins latency (1200s)
  await createUserLesson({
    userId: "latency-user",
    leetcodeId: 2,
    problemTitle: "P2",
    normalizedProblemTitle: "p2",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "understood",
    slackChannelId: "C1",
    slackMessageTs: "ts-2",
    sentAt: sent,
    respondedAt: new Date(sent.getTime() + 20 * 60 * 1000)
  });

  const latency = await getResponseLatency("latency-user");
  assert.ok(latency);
  assert.equal(latency.average_seconds, 900); // (600 + 1200) / 2 = 900
  assert.equal(latency.median_seconds, 900);
});

test("T8.2 getVagueTrendByTopic aggregates vague counts by topic correctly", async () => {
  await resetTable();

  // Arrays vague
  await createUserLesson({
    userId: "vague-user",
    leetcodeId: 1,
    problemTitle: "P1",
    normalizedProblemTitle: "p1",
    topic: "Arrays",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C1",
    slackMessageTs: "ts-1"
  });

  // Stacks vague
  await createUserLesson({
    userId: "vague-user",
    leetcodeId: 2,
    problemTitle: "P2",
    normalizedProblemTitle: "p2",
    topic: "Stacks",
    difficulty: "Easy",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C1",
    slackMessageTs: "ts-2"
  });

  // Arrays vague again
  await createUserLesson({
    userId: "vague-user",
    leetcodeId: 3,
    problemTitle: "P3",
    normalizedProblemTitle: "p3",
    topic: "Arrays",
    difficulty: "Medium",
    lessonMarkdown: "content",
    status: "vague",
    slackChannelId: "C1",
    slackMessageTs: "ts-3"
  });

  const trend = await getVagueTrendByTopic("vague-user");
  assert.equal(trend.length, 2);
  assert.equal(trend[0].topic, "Arrays");
  assert.equal(trend[0].vague_count, 2);
  assert.equal(trend[1].topic, "Stacks");
  assert.equal(trend[1].vague_count, 1);
});

test("T8.3 getUnderstoodStreak calculates current and max streaks correctly", async () => {
  await resetTable();

  const oneDay = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0); // mid-day today

  // Seed understood lessons on:
  // Today, Yesterday, 2 days ago, 4 days ago, 5 days ago, 6 days ago
  const activityOffsets = [0, 1, 2, 4, 5, 6];

  for (let i = 0; i < activityOffsets.length; i++) {
    const offset = activityOffsets[i];
    const respDate = new Date(today.getTime() - offset * oneDay);

    await createUserLesson({
      userId: "streak-user",
      leetcodeId: 100 + i,
      problemTitle: `P${i}`,
      normalizedProblemTitle: `p${i}`,
      topic: "Arrays",
      difficulty: "Easy",
      lessonMarkdown: "content",
      status: "understood",
      slackChannelId: "C1",
      slackMessageTs: `ts-s-${i}`,
      sentAt: new Date(respDate.getTime() - 2 * 60 * 60 * 1000),
      respondedAt: respDate
    });
  }

  const streak = await getUnderstoodStreak("streak-user");
  assert.equal(streak.currentStreak, 3); // Today, Yesterday, 2 days ago = 3
  assert.equal(streak.maxStreak, 3); // both are 3 because offsets [0,1,2] is length 3, and [4,5,6] is length 3
});
