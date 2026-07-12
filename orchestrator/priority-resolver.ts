import {
  getPendingLesson,
  getDueVagueLesson,
  getTopicProgress,
  hasProblemBeenSeen
} from "../db/src/repository.js";
import {
  determineActiveTopicAndDifficulty,
  Difficulty
} from "./curriculum.js";
import {
  runProblemSelectionAgent,
  PROBLEM_CATALOG
} from "../agents/problem-selection-agent.js";
import {
  fetchDatabaseQuestions,
  getSlug
} from "../agents/context-builder.js";

export type ResolutionType = "pending" | "vague_resend" | "new_selection";

export type ResolutionDecision = {
  type: ResolutionType;
  topic: string;
  difficulty: Difficulty;
  leetcode_id: number;
  problem_title: string;
  lesson_markdown?: string;
  lesson_version?: number;
  slack_channel_id?: string;
  slack_message_ts?: string;
};

export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " "); // collapse multiple whitespace
}

export function matchesTopic(tags: string[], topic: string): boolean {
  const normalizedTags = tags.map((t) => t.toLowerCase().replace(/[\s_\-]+/g, ""));
  const normalizedTopic = topic.toLowerCase().replace(/[\s_\-]+/g, "");

  // Extensible Database check: LeetCode SQL/Database problems are tagged with "database"
  if (normalizedTags.some((t) => t.includes("database") || t.includes("sql") || t.includes("join") || t.includes("union"))) {
    return true;
  }

  if (normalizedTopic.includes("hashmap") || normalizedTopic.includes("hashtable")) {
    return normalizedTags.some(
      (t) => t.includes("hashmap") || t.includes("hashtable") || t.includes("map")
    );
  }
  if (normalizedTopic.includes("array")) {
    return normalizedTags.some((t) => t.includes("array"));
  }
  if (normalizedTopic.includes("twopointer")) {
    return normalizedTags.some((t) => t.includes("twopointer") || t.includes("pointer"));
  }
  if (normalizedTopic.includes("slidingwindow")) {
    return normalizedTags.some((t) => t.includes("slidingwindow") || t.includes("window"));
  }
  if (normalizedTopic.includes("binarysearch")) {
    return normalizedTags.some((t) => t.includes("binarysearch") || t.includes("search"));
  }

  const singularTopic = normalizedTopic.endsWith("s") ? normalizedTopic.slice(0, -1) : normalizedTopic;
  return normalizedTags.some((t) => {
    const singularTag = t.endsWith("s") ? t.slice(0, -1) : t;
    return t.includes(normalizedTopic) || normalizedTopic.includes(t) || 
           singularTag.includes(singularTopic) || singularTopic.includes(singularTag);
  });
}

export async function resolveTodaysProblem(
  userId: string,
  vagueIntervalDays: number
): Promise<ResolutionDecision> {
  // 1. Priority 1: Check unanswered/pending lesson
  const pending = await getPendingLesson(userId);
  if (pending) {
    console.log(`Priority 1 resolved: found pending lesson for user ${userId}. Message ts: ${pending.slack_message_ts}`);
    return {
      type: "pending",
      topic: pending.topic,
      difficulty: pending.difficulty as Difficulty,
      leetcode_id: pending.leetcode_id,
      problem_title: pending.problem_title,
      lesson_markdown: pending.lesson_markdown,
      slack_channel_id: pending.slack_channel_id,
      slack_message_ts: pending.slack_message_ts
    };
  }

  // 2. Priority 2: Check vague lesson due for resend
  const vagueDue = await getDueVagueLesson(userId, vagueIntervalDays);
  if (vagueDue) {
    console.log(`Priority 2 resolved: found vague lesson due for resend. Problem: ${vagueDue.problem_title}`);
    return {
      type: "vague_resend",
      topic: vagueDue.topic,
      difficulty: vagueDue.difficulty as Difficulty,
      leetcode_id: vagueDue.leetcode_id,
      problem_title: vagueDue.problem_title,
      lesson_version: vagueDue.lesson_version + 1, // increment version
      slack_channel_id: vagueDue.slack_channel_id
    };
  }

  // 3. Priority 3: Select a new problem based on curriculum
  const progress = await getTopicProgress(userId);
  const activeTarget = determineActiveTopicAndDifficulty(progress);
  if (!activeTarget) {
    throw new Error("User has completed all curriculum targets!");
  }

  const { topic, difficulty } = activeTarget;
  console.log(`Determined active target: topic=${topic}, difficulty=${difficulty}`);

  // Fetch candidates from LeetCode GraphQL
  let rawPool: any[] = [];
  try {
    rawPool = await fetchDatabaseQuestions();
    console.log(`Fetched ${rawPool.length} Database problems from LeetCode GraphQL.`);
  } catch (err) {
    console.warn("Failed to fetch Database questions from GraphQL. Falling back to local catalog...", err);
  }

  // Fallback if empty or failed
  if (rawPool.length === 0) {
    console.log("Using local PROBLEM_CATALOG as fallback pool.");
    rawPool = PROBLEM_CATALOG;
  }

  // Deterministically filter candidates in code
  const candidates: { leetcode_id: number; problem_title: string }[] = [];
  for (const q of rawPool) {
    const id = parseInt(q.questionId || q.leetcode_id, 10);
    const title = q.title || q.problem_title;
    const isPaid = q.isPaidOnly || false;
    const diff = q.difficulty;
    const tags = (q.topicTags || []).map((t: any) => t.name);

    if (isPaid) continue;
    if (diff?.toLowerCase() !== difficulty.toLowerCase()) continue;

    // Check matches current topic
    const matches = q.topic 
      ? q.topic.toLowerCase() === topic.toLowerCase()
      : matchesTopic(tags, topic);

    if (!matches) continue;

    // Check seen
    const isDuplicate = await hasProblemBeenSeen(id, normalizeTitle(title), userId);
    if (isDuplicate) continue;

    candidates.push({ leetcode_id: id, problem_title: title });
  }

  if (candidates.length === 0) {
    throw new Error(`Failed to select a unique, validated problem: no unseen candidate problems found for topic="${topic}" and difficulty="${difficulty}".`);
  }

  console.log(`Code-filtered down to ${candidates.length} verified unseen candidate problems.`);

  // LLM ranks and selects the best candidate
  console.log(`Querying Problem Selection Agent to select the best candidate from ${candidates.length} options...`);
  const selected = await runProblemSelectionAgent(topic, difficulty, candidates.slice(0, 15));

  // Ensure selected candidate was in our list, fallback to first if any issues
  const confirmed = candidates.find((c) => c.leetcode_id === selected.leetcode_id) || candidates[0];
  console.log(`Selected problem resolved: ID=${confirmed.leetcode_id}, Title=${confirmed.problem_title}`);

  return {
    type: "new_selection",
    topic,
    difficulty,
    leetcode_id: confirmed.leetcode_id,
    problem_title: confirmed.problem_title
  };
}
