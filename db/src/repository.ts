import { query } from "./client.js";

export type DeliveryStatus = "pending" | "understood" | "vague";

export type UserLessonRecord = {
  id: number;
  user_id: string;
  leetcode_id: number;
  problem_title: string;
  normalized_problem_title: string;
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  lesson_markdown: string;
  lesson_version: number;
  teaching_score: string | null; // Postgres numeric returns as string in pg client
  status: DeliveryStatus;
  slack_channel_id: string;
  slack_message_ts: string;
  sent_at: Date;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CreateUserLessonInput = {
  userId: string;
  leetcodeId: number;
  problemTitle: string;
  normalizedProblemTitle: string;
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  lessonMarkdown: string;
  lessonVersion?: number;
  teachingScore?: number | null;
  status?: DeliveryStatus;
  slackChannelId: string;
  slackMessageTs: string;
  sentAt?: Date;
  respondedAt?: Date | null;
};

export type TopicProgressRecord = {
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  understood_count: number;
};

export async function getPendingLesson(userId: string): Promise<UserLessonRecord | null> {
  const { rows } = await query<UserLessonRecord>(
    `
      SELECT *
      FROM user_lessons
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY sent_at ASC
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] ?? null;
}

export async function getDueVagueLesson(
  userId: string,
  intervalDays: number
): Promise<UserLessonRecord | null> {
  const { rows } = await query<UserLessonRecord>(
    `
      SELECT *
      FROM user_lessons
      WHERE user_id = $1
        AND status = 'vague'
        AND responded_at IS NOT NULL
        AND responded_at <= NOW() - ($2 * INTERVAL '1 day')
      ORDER BY responded_at ASC
      LIMIT 1
    `,
    [userId, intervalDays]
  );

  return rows[0] ?? null;
}

export async function createUserLesson(input: CreateUserLessonInput): Promise<UserLessonRecord> {
  const { rows } = await query<UserLessonRecord>(
    `
      INSERT INTO user_lessons (
        user_id,
        leetcode_id,
        problem_title,
        normalized_problem_title,
        topic,
        difficulty,
        lesson_markdown,
        lesson_version,
        teaching_score,
        status,
        slack_channel_id,
        slack_message_ts,
        sent_at,
        responded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()), $14)
      RETURNING *
    `,
    [
      input.userId,
      input.leetcodeId,
      input.problemTitle,
      input.normalizedProblemTitle,
      input.topic,
      input.difficulty,
      input.lessonMarkdown,
      input.lessonVersion ?? 1,
      input.teachingScore ?? null,
      input.status ?? "pending",
      input.slackChannelId,
      input.slackMessageTs,
      input.sentAt ?? null,
      input.respondedAt ?? null
    ]
  );

  return rows[0];
}

export async function updateUserLessonStatus(
  slackMessageTs: string,
  status: DeliveryStatus
): Promise<UserLessonRecord | null> {
  const { rows } = await query<UserLessonRecord>(
    `
      UPDATE user_lessons
      SET
        status = $2,
        responded_at = NOW()
      WHERE slack_message_ts = $1
        AND status = 'pending'
      RETURNING *
    `,
    [slackMessageTs, status]
  );

  return rows[0] ?? null;
}

export async function getTopicProgress(userId: string): Promise<TopicProgressRecord[]> {
  const { rows } = await query<{ topic: string; difficulty: string; understood_count: string }>(
    `
      SELECT
        topic,
        difficulty,
        COUNT(*)::text AS understood_count
      FROM user_lessons
      WHERE user_id = $1 AND status = 'understood'
      GROUP BY topic, difficulty
    `,
    [userId]
  );

  return rows.map((row) => ({
    topic: row.topic,
    difficulty: row.difficulty as "Easy" | "Medium" | "Hard",
    understood_count: parseInt(row.understood_count, 10)
  }));
}

export async function hasProblemBeenSeen(
  leetcodeId: number,
  normalizedTitle: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM user_lessons
        WHERE user_id = $3
          AND (leetcode_id = $1 OR normalized_problem_title = $2)
      ) AS "exists"
    `,
    [leetcodeId, normalizedTitle, userId]
  );

  return rows[0]?.exists ?? false;
}

export async function updatePendingLessonTs(
  oldTs: string,
  newTs: string
): Promise<UserLessonRecord | null> {
  const { rows } = await query<UserLessonRecord>(
    `
      UPDATE user_lessons
      SET
        slack_message_ts = $2,
        sent_at = NOW(),
        updated_at = NOW()
      WHERE slack_message_ts = $1
        AND status = 'pending'
      RETURNING *
    `,
    [oldTs, newTs]
  );

  return rows[0] ?? null;
}

export async function getLessonByTs(
  slackMessageTs: string
): Promise<UserLessonRecord | null> {
  const { rows } = await query<UserLessonRecord>(
    `
      SELECT *
      FROM user_lessons
      WHERE slack_message_ts = $1
    `,
    [slackMessageTs]
  );

  return rows[0] ?? null;
}

export type ResponseLatencyResult = {
  average_seconds: number;
  median_seconds: number;
};

export async function getResponseLatency(
  userId: string
): Promise<ResponseLatencyResult | null> {
  const { rows } = await query<any>(
    `
      SELECT 
        AVG(EXTRACT(EPOCH FROM (responded_at - sent_at)))::FLOAT AS average_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - sent_at)))::FLOAT AS median_seconds
      FROM user_lessons
      WHERE user_id = $1 AND responded_at IS NOT NULL
    `,
    [userId]
  );

  if (rows[0] && rows[0].average_seconds !== null) {
    return {
      average_seconds: rows[0].average_seconds,
      median_seconds: rows[0].median_seconds ?? rows[0].average_seconds
    };
  }
  return null;
}

export type VagueTrendResult = {
  topic: string;
  vague_count: number;
};

export async function getVagueTrendByTopic(
  userId: string
): Promise<VagueTrendResult[]> {
  const { rows } = await query<VagueTrendResult>(
    `
      SELECT topic, COUNT(*)::INTEGER AS vague_count
      FROM user_lessons
      WHERE user_id = $1 AND status = 'vague'
      GROUP BY topic
      ORDER BY vague_count DESC
    `,
    [userId]
  );

  return rows;
}

export type StreakResult = {
  currentStreak: number;
  maxStreak: number;
};

export async function getUnderstoodStreak(
  userId: string
): Promise<StreakResult> {
  const { rows } = await query<{ u_date: Date }>(
    `
      SELECT DISTINCT DATE_TRUNC('day', responded_at) as u_date
      FROM user_lessons
      WHERE user_id = $1
        AND status = 'understood'
        AND responded_at IS NOT NULL
      ORDER BY u_date DESC
    `,
    [userId]
  );

  if (rows.length === 0) {
    return { currentStreak: 0, maxStreak: 0 };
  }

  // Map to UTC midnight timestamps
  const days = rows.map((r) => {
    const d = new Date(r.u_date);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  });

  const oneDayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const yesterdayMs = todayMs - oneDayMs;

  let currentStreak = 0;
  let maxStreak = 0;

  // 1. Calculate active current streak
  const hasActivityRecently = days[0] === todayMs || days[0] === yesterdayMs;
  if (hasActivityRecently) {
    currentStreak = 1;
    let expectedMs = days[0] - oneDayMs;
    for (let i = 1; i < days.length; i++) {
      if (days[i] === expectedMs) {
        currentStreak++;
        expectedMs -= oneDayMs;
      } else {
        break;
      }
    }
  }

  // 2. Calculate max historical streak
  let tempStreak = 1;
  maxStreak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === oneDayMs) {
      tempStreak++;
      if (tempStreak > maxStreak) {
        maxStreak = tempStreak;
      }
    } else if (days[i - 1] - days[i] > oneDayMs) {
      tempStreak = 1;
    }
  }

  return { currentStreak, maxStreak };
}
