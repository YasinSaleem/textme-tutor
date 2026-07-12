import { withClient } from "./client.js";

export type MockLessonSeed = {
  userId: string;
  leetcodeId: number;
  problemTitle: string;
  normalizedProblemTitle: string;
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  lessonMarkdown: string;
  lessonVersion: number;
  teachingScore: number | null;
  status: "pending" | "understood" | "vague";
  slackChannelId: string;
  slackMessageTs: string;
  sentAt: Date;
  respondedAt: Date | null;
};

export async function seedMockLessons(): Promise<number> {
  const mockLessons: MockLessonSeed[] = [
    // Understood lessons for topic progress testing (SELECT, Filtering & Joins progress: 3 Easy, 1 Medium -> actually let's keep Easy)
    {
      userId: "test-user",
      leetcodeId: 175,
      problemTitle: "Combine Two Tables",
      normalizedProblemTitle: "combine two tables",
      topic: "SELECT, Filtering & Joins",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Combine Two Tables",
      lessonVersion: 1,
      teachingScore: 9.5,
      status: "understood",
      slackChannelId: "C123",
      slackMessageTs: "1000000001.000100",
      sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    },
    {
      userId: "test-user",
      leetcodeId: 181,
      problemTitle: "Employees Earning More Than Their Managers",
      normalizedProblemTitle: "employees earning more than their managers",
      topic: "SELECT, Filtering & Joins",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Employees Earning More Than Their Managers",
      lessonVersion: 1,
      teachingScore: 8.8,
      status: "understood",
      slackChannelId: "C123",
      slackMessageTs: "1000000002.000200",
      sentAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)
    },
    {
      userId: "test-user",
      leetcodeId: 183,
      problemTitle: "Customers Who Never Order",
      normalizedProblemTitle: "customers who never order",
      topic: "SELECT, Filtering & Joins",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Customers Who Never Order",
      lessonVersion: 1,
      teachingScore: 8.2,
      status: "understood",
      slackChannelId: "C123",
      slackMessageTs: "1000000003.000300",
      sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    },
    {
      userId: "test-user",
      leetcodeId: 197,
      problemTitle: "Rising Temperature",
      normalizedProblemTitle: "rising temperature",
      topic: "SELECT, Filtering & Joins",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Rising Temperature",
      lessonVersion: 1,
      teachingScore: 9.1,
      status: "understood",
      slackChannelId: "C123",
      slackMessageTs: "1000000004.000400",
      sentAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    },
    // Vague lessons (one outside resend interval, one inside)
    {
      userId: "test-user",
      leetcodeId: 182,
      problemTitle: "Duplicate Emails",
      normalizedProblemTitle: "duplicate emails",
      topic: "Aggregation & Group By",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Duplicate Emails",
      lessonVersion: 1,
      teachingScore: 9.0,
      status: "vague",
      slackChannelId: "C123",
      slackMessageTs: "1000000005.000500",
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago (outside interval of 3 days)
    },
    {
      userId: "test-user",
      leetcodeId: 596,
      problemTitle: "Classes More Than 5 Students",
      normalizedProblemTitle: "classes more than 5 students",
      topic: "Aggregation & Group By",
      difficulty: "Easy",
      lessonMarkdown: "Lesson content for Classes More Than 5 Students",
      lessonVersion: 1,
      teachingScore: 8.7,
      status: "vague",
      slackChannelId: "C123",
      slackMessageTs: "1000000006.000600",
      sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      respondedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago (inside interval of 3 days)
    },
    // Pending lessons (one older, one newer)
    {
      userId: "test-user",
      leetcodeId: 176,
      problemTitle: "Second Highest Salary",
      normalizedProblemTitle: "second highest salary",
      topic: "Subqueries & CTEs",
      difficulty: "Medium",
      lessonMarkdown: "Lesson content for Second Highest Salary",
      lessonVersion: 1,
      teachingScore: 9.3,
      status: "pending",
      slackChannelId: "C123",
      slackMessageTs: "1000000007.000700",
      sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      respondedAt: null
    },
    {
      userId: "test-user",
      leetcodeId: 184,
      problemTitle: "Department Highest Salary",
      normalizedProblemTitle: "department highest salary",
      topic: "Subqueries & CTEs",
      difficulty: "Medium",
      lessonMarkdown: "Lesson content for Department Highest Salary",
      lessonVersion: 1,
      teachingScore: 9.6,
      status: "pending",
      slackChannelId: "C123",
      slackMessageTs: "1000000008.000800",
      sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      respondedAt: null
    }
  ];

  await withClient(async (client) => {
    // Truncate existing user_lessons to keep the seed clean and idempotent
    await client.query("TRUNCATE TABLE user_lessons RESTART IDENTITY CASCADE");

    await client.query("BEGIN");
    try {
      for (const lesson of mockLessons) {
        await client.query(
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            lesson.userId,
            lesson.leetcodeId,
            lesson.problemTitle,
            lesson.normalizedProblemTitle,
            lesson.topic,
            lesson.difficulty,
            lesson.lessonMarkdown,
            lesson.lessonVersion,
            lesson.teachingScore,
            lesson.status,
            lesson.slackChannelId,
            lesson.slackMessageTs,
            lesson.sentAt,
            lesson.respondedAt
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });

  return mockLessons.length;
}
