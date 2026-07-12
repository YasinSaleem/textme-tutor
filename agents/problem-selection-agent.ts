import { callLLM, LLMMessage } from "./llm.js";
import { parseJSONResponse } from "./pipeline.js";

export type ProblemCandidate = {
  leetcode_id: number;
  problem_title: string;
};

// Seed catalog of real LeetCode database problems sorted by curriculum topics (fallback database)
export const PROBLEM_CATALOG = [
  // 1. SELECT, Filtering & Joins (Easy)
  { leetcode_id: 175, problem_title: "Combine Two Tables", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 181, problem_title: "Employees Earning More Than Their Managers", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 183, problem_title: "Customers Who Never Order", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 197, problem_title: "Rising Temperature", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 584, problem_title: "Find Customer Referee", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 595, problem_title: "Big Countries", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 607, problem_title: "Sales Person", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 1068, problem_title: "Product Sales Analysis I", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 1378, problem_title: "Replace Employee ID With The Unique Identifier", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },
  { leetcode_id: 1581, problem_title: "Customer Who Visited but Did Not Make Any Transactions", topic: "SELECT, Filtering & Joins", difficulty: "Easy" },

  // 2. Aggregation & Group By (Easy/Medium)
  { leetcode_id: 182, problem_title: "Duplicate Emails", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 596, problem_title: "Classes More Than 5 Students", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 620, problem_title: "Not Boring Movies", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1050, problem_title: "Actors and Directors Who Cooperated At Least Three Times", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1075, problem_title: "Project Employees I", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1251, problem_title: "Average Selling Price", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1484, problem_title: "Group Sold Products By The Date", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1587, problem_title: "Bank Account Summary II", topic: "Aggregation & Group By", difficulty: "Medium" },
  { leetcode_id: 1693, problem_title: "Daily Leads and Partners", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1729, problem_title: "Find Followers Count", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 1741, problem_title: "Find Total Time Spent by Each Employee", topic: "Aggregation & Group By", difficulty: "Easy" },
  { leetcode_id: 2356, problem_title: "Number of Unique Subjects Taught by Each Teacher", topic: "Aggregation & Group By", difficulty: "Easy" },

  // 3. Subqueries & CTEs (Medium)
  { leetcode_id: 176, problem_title: "Second Highest Salary", topic: "Subqueries & CTEs", difficulty: "Medium" },
  { leetcode_id: 184, problem_title: "Department Highest Salary", topic: "Subqueries & CTEs", difficulty: "Medium" },
  { leetcode_id: 570, problem_title: "Managers with at least 5 Direct Reports", topic: "Subqueries & CTEs", difficulty: "Medium" },
  { leetcode_id: 586, problem_title: "Customer Placing the Largest Number of Orders", topic: "Subqueries & CTEs", difficulty: "Easy" },
  { leetcode_id: 602, problem_title: "Friend Requests II: Who Has the Most Friends", topic: "Subqueries & CTEs", difficulty: "Medium" },
  { leetcode_id: 619, problem_title: "Biggest Single Number", topic: "Subqueries & CTEs", difficulty: "Easy" },
  { leetcode_id: 1084, problem_title: "Sales Analysis III", topic: "Subqueries & CTEs", difficulty: "Easy" },
  { leetcode_id: 1341, problem_title: "Movie Rating", topic: "Subqueries & CTEs", difficulty: "Medium" },
  { leetcode_id: 1393, problem_title: "Capital Gain/Loss", topic: "Subqueries & CTEs", difficulty: "Medium" },

  // 4. Window Functions (Medium/Hard)
  { leetcode_id: 178, problem_title: "Rank Scores", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 180, problem_title: "Consecutive Numbers", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 185, problem_title: "Department Top Three Salaries", topic: "Window Functions", difficulty: "Hard" },
  { leetcode_id: 608, problem_title: "Tree Node", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 626, problem_title: "Exchange Seats", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 1164, problem_title: "Product Price at a Given Date", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 1204, problem_title: "Last Person to Fit in the Elevator", topic: "Window Functions", difficulty: "Medium" },
  { leetcode_id: 1321, problem_title: "Restaurant Growth", topic: "Window Functions", difficulty: "Medium" },

  // 5. Date & String Manipulation (Easy/Medium)
  { leetcode_id: 197, problem_title: "Rising Temperature", topic: "Date & String Manipulation", difficulty: "Easy" },
  { leetcode_id: 1141, problem_title: "User Activity for the Past 30 Days I", topic: "Date & String Manipulation", difficulty: "Easy" },
  { leetcode_id: 1517, problem_title: "Find Users With Valid E-Mails", topic: "Date & String Manipulation", difficulty: "Easy" },
  { leetcode_id: 1527, problem_title: "Patients With a Condition", topic: "Date & String Manipulation", difficulty: "Easy" },
  { leetcode_id: 1667, problem_title: "Fix Names in a Table", topic: "Date & String Manipulation", difficulty: "Easy" },
  { leetcode_id: 1873, problem_title: "Calculate Special Bonus", topic: "Date & String Manipulation", difficulty: "Easy" }
];

export async function runProblemSelectionAgent(
  topic: string,
  difficulty: "Easy" | "Medium" | "Hard",
  candidates: ProblemCandidate[]
): Promise<ProblemCandidate> {
  const systemPrompt = `You are an expert SQL Curriculum Selector Agent.
Your job is to select the single best PostgreSQL query problem from the provided list of verified candidates to teach the topic: "${topic}".

Rules:
- The supplied candidate list is the ONLY valid search space.
- Do NOT invent, modify, or infer additional problems. You must select one from the provided list.
- Return your output ONLY as a JSON object matching this structure:
{
  "selected_id": number,
  "selected_title": "string"
}`;

  const userPrompt = `Target Topic: ${topic}
Target Difficulty: ${difficulty}
Candidates:
${candidates.map((c) => `- ID: ${c.leetcode_id} | Title: ${c.problem_title}`).join("\n")}

Select the best candidate from the list now.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const content = await callLLM(messages, {
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const parsed = parseJSONResponse<{ selected_id: number; selected_title: string }>(content);
  return {
    leetcode_id: parsed.selected_id,
    problem_title: parsed.selected_title
  };
}
