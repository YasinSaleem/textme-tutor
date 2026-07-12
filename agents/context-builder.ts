import { getTopicProgress } from "../db/src/repository.js";

export type ProblemContext = {
  leetcode_id: number;
  problem_title: string;
  topic: string;
  difficulty: string;
  statement: string;
  constraints: string;
  examples: string[];
  tags: string[];
  user_topic_progress: {
    topic: string;
    difficulty: "Easy" | "Medium" | "Hard";
    understood_count: number;
  }[];
};

export function getSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // remove special characters
    .trim()
    .replace(/[\s-]+/g, "-");     // replace spaces or multiple hyphens with a single hyphen
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li>/gi, "\n- ")
    .replace(/<sup>(.*?)<\/sup>/g, "^$1")
    .replace(/<sub>(.*?)<\/sub>/g, "_$1")
    .replace(/<[^>]*>/g, "") // strip HTML tags first
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")   // replace entities after
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseLeetCodeHTML(html: string): {
  statement: string;
  constraints: string;
  examples: string[];
} {
  // 1. Extract examples from <pre> tags
  const examples: string[] = [];
  const preRegex = /<pre>([\s\S]*?)<\/pre>/gi;
  let match;
  while ((match = preRegex.exec(html)) !== null) {
    const cleanPre = stripHtmlTags(match[1]).trim();
    if (cleanPre) {
      examples.push(cleanPre);
    }
  }

  // 2. Extract constraints
  let constraints = "";
  const constraintsIndex = html.toLowerCase().indexOf("constraints:");
  if (constraintsIndex !== -1) {
    const rawConstraintsHTML = html.substring(constraintsIndex);
    const ulMatch = /<ul>([\s\S]*?)<\/ul>/i.exec(rawConstraintsHTML);
    if (ulMatch) {
      constraints = stripHtmlTags(ulMatch[0]).trim();
    } else {
      constraints = stripHtmlTags(rawConstraintsHTML).trim();
    }
  }

  // 3. Extract statement (everything before Example 1 or first <pre> or Constraints)
  let statementEndIndex = html.toLowerCase().indexOf("example 1");
  if (statementEndIndex === -1) {
    statementEndIndex = html.toLowerCase().indexOf("<pre>");
  }
  if (statementEndIndex === -1) {
    statementEndIndex = constraintsIndex;
  }

  const rawStatementHTML = statementEndIndex !== -1 ? html.substring(0, statementEndIndex) : html;
  
  // Clean up clean statement text
  const statement = stripHtmlTags(rawStatementHTML)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return {
    statement: statement || "No problem statement specified.",
    constraints: constraints || "No constraints specified.",
    examples: examples.length > 0 ? examples : ["No examples specified."]
  };
}

export async function fetchLeetCodeProblem(titleSlug: string): Promise<{
  difficulty: string;
  content: string;
  tags: string[];
} | null> {
  const query = `
    query questionContent($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        difficulty
        content
        topicTags {
          name
        }
      }
    }
  `;

  try {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        query,
        variables: { titleSlug }
      })
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as any;
    const question = json?.data?.question;
    if (!question) {
      return null;
    }

    const tags = (question.topicTags || []).map((t: any) => t.name as string);
    return {
      difficulty: question.difficulty as string,
      content: question.content as string,
      tags
    };
  } catch (error) {
    console.error("Failed to fetch LeetCode problem:", error);
    return null;
  }
}

export async function buildProblemContext(
  leetcodeId: number,
  problemTitle: string,
  topic: string,
  userId: string
): Promise<ProblemContext | null> {
  const slug = getSlug(problemTitle);
  const problemDetails = await fetchLeetCodeProblem(slug);
  if (!problemDetails) {
    return null;
  }

  const { statement, constraints, examples } = parseLeetCodeHTML(problemDetails.content);
  const userProgress = await getTopicProgress(userId);

  return {
    leetcode_id: leetcodeId,
    problem_title: problemTitle,
    topic,
    difficulty: problemDetails.difficulty,
    statement,
    constraints,
    examples,
    tags: problemDetails.tags,
    user_topic_progress: userProgress
  };
}

export async function fetchDatabaseQuestions(): Promise<any[]> {
  const queryStr = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        questions: data {
          questionId
          title: questionTitle
          titleSlug
          difficulty
          isPaidOnly
          topicTags {
            name
            slug
          }
        }
      }
    }
  `;

  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: queryStr,
      variables: {
        categorySlug: "database",
        limit: 100,
        skip: 0,
        filters: {}
      }
    })
  });

  if (!response.ok) {
    throw new Error(`LeetCode GraphQL error: ${response.status}`);
  }

  const json = (await response.json()) as any;
  return json.data?.problemsetQuestionList?.questions || [];
}
