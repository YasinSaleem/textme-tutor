import { callLLM, LLMMessage } from "./llm.js";
import { ProblemContext } from "./context-builder.js";
import { ReviewResult, PipelineResult } from "./pipeline-types.js";

export function parseJSONResponse<T>(text: string): T {
  const clean = text
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(clean) as T;
}

// Stage 1: Schema Agent
export async function runSchemaAgent(context: ProblemContext): Promise<string> {
  const systemPrompt = `You are an expert SQL Schema Agent.
Extract all table names, columns, data types, primary/foreign keys (where applicable), and logical relationships from the LeetCode database problem context.
Do NOT write or suggest queries. Focus purely on outlining the structural schema catalog.`;

  const userPrompt = `Problem: ${context.problem_title} (${context.difficulty})
Topic: ${context.topic}
Statement: ${context.statement}
Constraints: ${context.constraints}
Examples:
${context.examples.join("\n\n")}`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  return callLLM(messages, { temperature: 0.1 });
}

// Stage 2: Intuition Agent
export async function runIntuitionAgent(
  context: ProblemContext,
  schemaInfo: string
): Promise<string> {
  const systemPrompt = `You are an expert SQL Intuition Agent.
Your goal is to explain the logical solution strategy independently of SQL syntax (joins, grouping, partitioning, filtering, etc.).
Ensure you guide the reader to the "aha" moment.

Teaching Principle: Prioritize explaining WHY the query logic works. SQL syntax is simply the implementation of the underlying reasoning, not the primary learning objective.`;

  const userPrompt = `Problem: ${context.problem_title}
Topic: ${context.topic}
Statement: ${context.statement}

Database Schema Context:
${schemaInfo}

Provide the database-agnostic intuition walkthrough now.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  return callLLM(messages, { temperature: 0.5 });
}

// Stage 3: Query Builder Agent
export async function runQueryBuilderAgent(
  context: ProblemContext,
  schemaInfo: string,
  logicalIntuition: string,
  previousReviewFeedback?: string
): Promise<string> {
  const systemPrompt = `You are an expert SQL Query Builder Agent.
Generate a clean, comment-free PostgreSQL query solution (do NOT write inline comments -- e.g. -- comments -- inside the actual SQL query block itself) matching the logical intuition and schema constraints.

PostgreSQL-Only Enforcement:
- Targets PostgreSQL exclusively. Prefer idiomatic PostgreSQL constructs like standard CTEs, window functions, FILTER (WHERE ...), COALESCE, DISTINCT ON (when appropriate), and standard casting (e.g. ::float).
- Do NOT use MySQL-specific syntax (such as IF() or non-deterministic standard columns inside GROUP BY).
- Make sure queries are standards-compliant and highly readable.
- Explain the query's construction details (joins, filters, window partition mechanics). Do NOT write inline comments inside the SQL code block.

Preamble Stripping:
- Return ONLY the query walkthrough. Do NOT include preambles, notes, wrapper packaging, or metadata outside the explanation.
${previousReviewFeedback ? `- Note from reviewer: Resolve these issues in the query: ${previousReviewFeedback}` : ""}`;

  const userPrompt = `Problem: ${context.problem_title}
Schema:
${schemaInfo}

Core Intuition:
${logicalIntuition}

Please build the PostgreSQL query now.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  return callLLM(messages, { temperature: 0.4 });
}

// Stage 4: Reviewer Agent (Pass/Fail Validation)
export async function runReviewerAgent(queryWalkthrough: string): Promise<ReviewResult> {
  const systemPrompt = `You are an expert SQL Reviewer Agent.
Validate the correctness of the generated PostgreSQL solution walkthrough. Do NOT assign numeric scores.

Perform a pass/fail review checking:
1. PostgreSQL syntax standards.
2. Proper alignment of table/column names with the schema.
3. Deterministic sorting via ORDER BY where required.
4. Correct NULL handling (using IS NULL, COALESCE, etc.).
5. Duplicate row handling (e.g., DISTINCT, UNION vs UNION ALL).
6. Minimizing redundant subquery nesting.
7. Readable, clear table/column aliases.

You must return your output ONLY as a JSON object matching this structure:
{
  "valid": boolean,
  "issues": "detailed bulleted list of validation failures, empty string if valid",
  "suggested_fixes": "suggested fixes for the issues, empty string if valid"
}`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: queryWalkthrough }
  ];

  const content = await callLLM(messages, {
    temperature: 0.1,
    response_format: { type: "json_object" }
  });

  return parseJSONResponse<ReviewResult>(content);
}

// Stage 5: Formatter Agent
export async function runFormatterAgent(consolidatedLesson: string): Promise<string> {
  const systemPrompt = `You are an expert Slack Formatter.
Format the provided SQL lesson walkthrough into a structured JSON payload conforming strictly to the Slack mrkdwn specification.

Slack mrkdwn Formatting Rules:
- Headings: Represent headings using bold formatting (e.g. *Heading Text*). Do NOT use '#', '##', or '###'.
- Bold Emphasis: Use single asterisks (*bold*). Do NOT use '**bold**'.
- Italic Emphasis: Use underscores (_italic_). Do NOT use '*italic*'.
- Inline Code: Use single backticks (\`code\`).
- Code Blocks: Use triple backticks (\`\`\`sql ... \`\`\`).
- Lists: Use bullet points (• item) or dashes (- item).
- Tables: Do NOT use Markdown table syntax (e.g. | col1 | col2 |). Instead, standardize on monospaced ASCII grid tables inside code blocks (using \`\`\`text ... \`\`\`) for the "Expected Output" section so that the output tables render nicely.
- HTML: Do NOT use any HTML tags.

You must return your output ONLY as a JSON object matching this structure:
{
  "parent_message": "Problem statement, schema definition tables, and sample inputs.",
  "replies": [
    "*Core Intuition*\\nLogical step-by-step approach explaining _why_ the logic works independently of SQL syntax.",
    "*Step-by-Step Query Construction*\\nDetailed explanation of joins, CTEs, filters, aggregation, and window functions.",
    "*PostgreSQL Query*\\n\`\`\`sql\\nselect ...\\n\`\`\`",
    "*Expected Output & Standardized Edge Cases*\\n- Expected Output:\\n\`\`\`text\\n+------+------+\\n| col1 | col2 |\\n+------+------+\\n| val1 | val2 |\\n+------+------+\\n\`\`\`\\n- Edge Cases:\\n  • NULL values: ...\\n  • Duplicate rows: ...\\n  • Empty tables: ...\\n  • Multiple matching rows: ...\\n  • Sorting requirements: ..."
  ]
}

Ensure that:
- "parent_message" must format the problem details exactly matching this structured layout with double-newlines:
  Problem statement:
  [A clear description of the problem statement]

  Schema:
  [List each table name and column types, each on a new line, e.g., TableName(col1, col2)]

  Sample data:
  [Provide mock data input records, with each table's data on a separate line]
- "replies" contains exactly 4 entries in the specified order.
- Do NOT include preambles, packaging wrappers (like \`\`\`json), or word-count notes outside of the JSON. Return only raw JSON.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: consolidatedLesson }
  ];

  return callLLM(messages, {
    temperature: 0.1,
    response_format: { type: "json_object" }
  });
}

// T3.11 - Full pipeline wiring
export async function runTeachingPipeline(
  context: ProblemContext,
  vagueResend = false
): Promise<PipelineResult> {
  console.log(`Starting SQL teaching pipeline for: ${context.problem_title} (${context.difficulty})`);

  // 1. Extract Schema
  console.log("Stage 1: Extracting SQL schema...");
  const schemaInfo = await runSchemaAgent(context);

  // 2. Build core intuition
  console.log("Stage 2: Building core SQL intuition...");
  const logicalIntuition = await runIntuitionAgent(context, schemaInfo);

  const maxAttempts = 3;
  let attempt = 0;
  let queryWalkthrough = "";
  let review: ReviewResult = { valid: false, issues: "", suggested_fixes: "" };

  // 3 & 4. Query Builder & Review Loop (Decisions managed by pipeline orchestrator)
  while (attempt < maxAttempts) {
    attempt++;
    console.log(`Stage 3: Generating PostgreSQL query attempt ${attempt}/${maxAttempts}...`);
    
    const feedback = attempt > 1 
      ? `Validation failed in previous attempt. Issues:\n${review.issues}\nSuggested Fixes:\n${review.suggested_fixes}` 
      : undefined;

    queryWalkthrough = await runQueryBuilderAgent(
      context,
      schemaInfo,
      logicalIntuition,
      feedback
    );

    console.log(`Stage 4: Validating query via Reviewer Agent...`);
    review = await runReviewerAgent(queryWalkthrough);
    console.log(`Validation result: ${review.valid ? "PASSED" : "FAILED"}`);

    if (review.valid) {
      break;
    }
  }

  // 5. Formatting
  console.log(`Stage 5: Formatting final lesson payload for Slack...`);
  const consolidatedLesson = `
Schema Context:
${schemaInfo}

Core Intuition:
${logicalIntuition}

Query Walkthrough & Code:
${queryWalkthrough}
  `.trim();

  const formattedJson = await runFormatterAgent(consolidatedLesson);

  return {
    lesson_markdown: consolidatedLesson,
    teaching_score: review.valid ? 10.0 : 0.0, // compatibility rating
    review_reason: review.issues || "Passed SQL reviewer validation.",
    formatted_json: formattedJson
  };
}
