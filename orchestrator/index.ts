import { resolveTodaysProblem } from "./priority-resolver.js";
import { buildProblemContext } from "../agents/context-builder.js";
import { runTeachingPipeline } from "../agents/pipeline.js";
import { postSlackMessage } from "../slack/publisher.js";
import { createUserLesson, updatePendingLessonTs } from "../db/src/repository.js";
import { closePool } from "../db/src/client.js";

export async function runOrchestrator() {
  const userId = process.env.USER_ID || "default-user";
  const channelId = process.env.SLACK_CHANNEL_ID;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const vagueInterval = parseInt(process.env.VAGUE_RESEND_INTERVAL_DAYS || "3", 10);

  if (!channelId || !botToken) {
    throw new Error("SLACK_CHANNEL_ID or SLACK_BOT_TOKEN is not set in environment.");
  }

  console.log(`Starting orchestrator run for user: ${userId}`);

  // 1. Resolve today's action
  const decision = await resolveTodaysProblem(userId, vagueInterval);
  console.log(`Resolution complete. Decision Type: ${decision.type}`);

  let lessonMarkdown = "";
  let score: number | null = null;
  let version = 1;
  let formattedJsonStr = "";

  if (decision.type === "pending") {
    console.log(`Re-using existing pending lesson for problem: ${decision.problem_title}`);
    lessonMarkdown = decision.lesson_markdown!;
    console.log("Formatting pending lesson for Slack thread replies...");
    const { runFormatterAgent } = await import("../agents/pipeline.js");
    formattedJsonStr = await runFormatterAgent(lessonMarkdown);
  } else {
    // Priority 2 or 3: generate a new lesson version
    console.log(`Building context for: ${decision.problem_title} (${decision.difficulty})`);
    const context = await buildProblemContext(
      decision.leetcode_id,
      decision.problem_title,
      decision.topic,
      userId
    );

    if (!context) {
      throw new Error(`Failed to build context for problem "${decision.problem_title}".`);
    }

    console.log(`Generating teaching lesson pipeline (isVagueRegen=${decision.type === "vague_resend"})...`);
    const pipelineResult = await runTeachingPipeline(context, decision.type === "vague_resend");
    lessonMarkdown = pipelineResult.lesson_markdown;
    score = pipelineResult.teaching_score;
    version = decision.type === "vague_resend" ? decision.lesson_version! : 1;
    formattedJsonStr = pipelineResult.formatted_json;
  }

  // Parse Formatter JSON
  let parentText = "";
  let replies: string[] = [];
  try {
    const cleanStr = formattedJsonStr
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = JSON.parse(cleanStr);
    parentText = parsed.parent_message || parsed.parentMessage || "";
    replies = parsed.replies || parsed.reply_messages || parsed.replyMessages || [];
  } catch (e) {
    console.error("Failed to parse formatted JSON, falling back to unified post:", e);
    parentText = lessonMarkdown;
    replies = [];
  }

  // Ensure parentText is never empty to prevent Slack "no_text" API errors
  if (!parentText) {
    console.warn("Parsed parent_message is empty. Falling back to lessonMarkdown.");
    parentText = lessonMarkdown;
  }

  // 2. Publish to Slack
  console.log(`Posting parent lesson to Slack channel ${channelId}...`);
  const parentTs = await postSlackMessage(botToken, channelId, parentText);
  console.log(`Parent lesson posted successfully. Slack TS: ${parentTs}`);

  if (replies.length > 0) {
    console.log(`Posting ${replies.length} replies to thread ${parentTs}...`);
    for (let i = 0; i < replies.length; i++) {
      console.log(`Posting reply ${i + 1}/${replies.length}...`);
      await postSlackMessage(botToken, channelId, replies[i], parentTs);
    }
  }

  // 3. Database Write (only occurs if LLM and Slack steps succeed)
  if (decision.type === "pending") {
    console.log(`Updating existing pending lesson timestamp in DB...`);
    const updated = await updatePendingLessonTs(decision.slack_message_ts!, parentTs);
    if (!updated) {
      throw new Error(`Failed to update pending lesson timestamp from ${decision.slack_message_ts} to ${parentTs}`);
    }
  } else {
    console.log(`Saving new pending lesson to DB...`);
    await createUserLesson({
      userId,
      leetcodeId: decision.leetcode_id,
      problemTitle: decision.problem_title,
      normalizedProblemTitle: decision.problem_title.toLowerCase().trim().replace(/\s+/g, " "),
      topic: decision.topic,
      difficulty: decision.difficulty,
      lessonMarkdown,
      lessonVersion: version,
      teachingScore: score,
      status: "pending",
      slackChannelId: channelId,
      slackMessageTs: parentTs
    });
  }

  console.log("Orchestrator execution finished successfully.");
}

async function main() {
  try {
    await runOrchestrator();
    process.exitCode = 0;
  } catch (error) {
    console.error("CRITICAL: Orchestrator failed during execution:", error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== "test" && (process.argv[1]?.endsWith("orchestrator/index.ts") || process.argv[1]?.endsWith("orchestrator/index.js") || process.argv[1]?.endsWith("orchestrator"))) {
  main();
}
