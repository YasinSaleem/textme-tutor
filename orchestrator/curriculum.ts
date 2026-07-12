export type Difficulty = "Easy" | "Medium" | "Hard";

export type TopicTarget = {
  topic: string;
  target: number;
  difficulties: {
    Easy: number;
    Medium: number;
    Hard: number;
  };
};

export const CURRICULUM: TopicTarget[] = [
  {
    topic: "SELECT, Filtering & Joins",
    target: 10,
    difficulties: { Easy: 10, Medium: 0, Hard: 0 }
  },
  {
    topic: "Aggregation & Group By",
    target: 8,
    difficulties: { Easy: 0, Medium: 8, Hard: 0 }
  },
  {
    topic: "Subqueries & CTEs",
    target: 8,
    difficulties: { Easy: 0, Medium: 8, Hard: 0 }
  },
  {
    topic: "Window Functions",
    target: 6,
    difficulties: { Easy: 0, Medium: 4, Hard: 2 }
  },
  {
    topic: "Date & String Manipulation",
    target: 4,
    difficulties: { Easy: 0, Medium: 4, Hard: 0 }
  }
];

export type TopicProgressSummary = {
  topic: string;
  difficulty: Difficulty;
  understood_count: number;
};

export function determineActiveTopicAndDifficulty(
  progress: TopicProgressSummary[]
): { topic: string; difficulty: Difficulty } | null {
  for (const target of CURRICULUM) {
    const progressMap = {
      Easy: 0,
      Medium: 0,
      Hard: 0
    };

    for (const p of progress) {
      if (p.topic.toLowerCase() === target.topic.toLowerCase()) {
        progressMap[p.difficulty] = p.understood_count;
      }
    }

    // Check Easy progression first
    if (target.difficulties.Easy > 0 && progressMap.Easy < target.difficulties.Easy) {
      return { topic: target.topic, difficulty: "Easy" };
    }
    // Check Medium progression
    if (target.difficulties.Medium > 0 && progressMap.Medium < target.difficulties.Medium) {
      return { topic: target.topic, difficulty: "Medium" };
    }
    // Check Hard progression
    if (target.difficulties.Hard > 0 && progressMap.Hard < target.difficulties.Hard) {
      return { topic: target.topic, difficulty: "Hard" };
    }
  }

  // Curriculum completed
  return null;
}
