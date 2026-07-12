import http from "node:http";
import crypto from "node:crypto";
import { getLessonByTs, updateUserLessonStatus } from "../db/src/repository.js";
import { callLLM, LLMMessage } from "../agents/llm.js";
import { postSlackMessage, getSlackThreadHistory } from "./publisher.js";

export type UserIntent = "understood" | "not_understood" | "conversational";

// T7.1 - Signature verification helper
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    console.warn("Slack signature validation failed: request timestamp is older than 5 minutes.");
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(baseString);
  const mySignature = `v0=${hmac.digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch (err) {
    return false;
  }
}

// T7.3 - Intent Parser
export async function parseUserIntent(message: string): Promise<UserIntent> {
  const cleanMessage = message.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");

  // Local fast-path checks
  const understoodWords = ["yes", "yep", "yup", "understood", "got it", "makes sense", "i understand", "i get it", "clear", "perfect"];
  const notUnderstoodWords = ["no", "nope", "vague", "confusing", "didnt get it", "dont understand", "dont get it", "explain again", "still confusing"];

  if (understoodWords.includes(cleanMessage)) {
    return "understood";
  }
  if (notUnderstoodWords.includes(cleanMessage)) {
    return "not_understood";
  }

  // Prefix match checks for standard starts
  if (/^(yes|yep|yup|understood|got it)\b/.test(cleanMessage)) {
    return "understood";
  }
  if (/^(no|nope|vague|confusing)\b/.test(cleanMessage)) {
    return "not_understood";
  }

  const systemPrompt = `You are an expert User Intent Classifier for a DSA teaching bot.
Classify the user's message into exactly one of three categories:
1. "understood": The user explicitly indicates they understood the problem, got it, or found the explanation clear (e.g., "yes", "understood", "yep", "makes sense", "got it", "i understand", "i get it").
2. "not_understood": The user indicates they did not understand, found it confusing, or found it vague (e.g., "no", "vague", "still confusing", "explain again", "didn't get it", "what?").
3. "conversational": The user is asking a question, seeking clarification, or chatting (e.g., "why is the space complexity O(N)?", "what is a hash map?").

You must return ONLY one of these three strings: "understood", "not_understood", or "conversational". Do NOT return any other text, quotes, or markdown.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message }
  ];

  const response = await callLLM(messages, {
    temperature: 0.0,
    max_tokens: 10
  });

  const cleaned = response.trim().toLowerCase().replace(/[^a-z_]/g, "");
  if (cleaned === "understood" || cleaned === "not_understood" || cleaned === "conversational") {
    return cleaned as UserIntent;
  }
  return "conversational"; // fallback
}

// T7.5 - Conversational agent
export async function runConversationalAgent(
  botToken: string,
  channel: string,
  threadTs: string,
  lessonMarkdown: string,
  problemTitle: string,
  mockHistory?: { role: "user" | "assistant"; text: string }[]
): Promise<string> {
  let history = mockHistory;
  if (!history) {
    history = await getSlackThreadHistory(botToken, channel, threadTs);
  }

  const systemPrompt = `You are a helpful, conversational DSA Tutor explaining LeetCode problems.
The user is asking questions about the problem: "${problemTitle}".
Here was the original lesson explanation sent to them:
${lessonMarkdown}

Be friendly, concise, and structured. Explain key intuition, complexities, and logic.
Avoid writing out full code solutions or linking to editorials unless asked for a very specific detail.
Your response must be formatted in Slack Markdown (mrkdwn). Keep it short enough to read in a chat thread.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt }
  ];

  for (const h of history) {
    messages.push({
      role: h.role,
      content: h.text
    });
  }

  return await callLLM(messages, {
    temperature: 0.7
  });
}

// T7.4 - State transition and reply handling
export async function handleThreadReply(
  channel: string,
  threadTs: string,
  messageText: string,
  mockIntent?: UserIntent,
  mockTutorReply?: string
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN || "";
  
  // T7.2 - Thread to lesson lookup
  const lesson = await getLessonByTs(threadTs);
  if (!lesson) {
    console.warn(`No lesson found in DB matching thread_ts: ${threadTs}`);
    return;
  }

  const intent = mockIntent || await parseUserIntent(messageText);
  console.log(`Handling thread reply: thread_ts=${threadTs}, intent=${intent}`);

  if (intent === "understood") {
    await updateUserLessonStatus(threadTs, "understood");
    await postSlackMessage(
      botToken,
      channel,
      "Awesome! I've marked this problem as understood. You are moving closer to your progression target! 🚀",
      threadTs
    );
  } else if (intent === "not_understood") {
    await updateUserLessonStatus(threadTs, "vague");
    await postSlackMessage(
      botToken,
      channel,
      "Got it. I've marked this explanation as vague. I will regenerate and resend a clearer walkthrough of this problem in our next scheduled session! 📚",
      threadTs
    );
  } else {
    // Conversational path
    const replyText = mockTutorReply || await runConversationalAgent(
      botToken,
      channel,
      threadTs,
      lesson.lesson_markdown,
      lesson.problem_title
    );
    await postSlackMessage(botToken, channel, replyText, threadTs);
  }
}

// HTTP Webhook Server (Process B Entrypoint)
export function createListenerServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    const timestamp = req.headers["x-slack-request-timestamp"] as string;
    const signature = req.headers["x-slack-signature"] as string;

    if (!timestamp || !signature) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized: Missing signature headers");
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
      if (!verifySlackSignature(signingSecret, body, timestamp, signature)) {
        console.warn("Invalid Slack signature detected.");
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized: Signature mismatch");
        return;
      }

      try {
        const data = JSON.parse(body);

        // Webhook challenge verification
        if (data.type === "url_verification") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ challenge: data.challenge }));
          return;
        }

        // Webhook event callback routing
        if (data.type === "event_callback") {
          // Send 200 OK immediately to Slack
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("OK");

          const event = data.event;
          if (event && event.type === "message") {
            if (event.bot_id || event.subtype === "bot_message") {
              return; // Avoid reply loop
            }

            const threadTs = event.thread_ts;
            if (threadTs) {
              await handleThreadReply(event.channel, threadTs, event.text);
            }
          }
          return;
        }

        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
      } catch (err) {
        console.error("Error processing request:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  });
}

// Start listener server if executed directly
if (
  process.env.NODE_ENV !== "test" &&
  (process.argv[1]?.endsWith("slack/listener.ts") ||
    process.argv[1]?.endsWith("slack/listener.js") ||
    process.argv[1]?.endsWith("listener"))
) {
  const server = createListenerServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Always-on response listener (Process B) running on port ${port}`);
  });
}
