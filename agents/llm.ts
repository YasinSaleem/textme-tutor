import fs from "node:fs";
import path from "node:path";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMOptions = {
  temperature?: number;
  max_tokens?: number;
  model?: string;
  response_format?: { type: "json_object" };
};

function logTokenUsage(model: string, usage: any, cost?: number) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    model,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    cost: cost ?? usage?.cost ?? 0
  };

  console.log(`[LLM Usage] Model: ${model} | Tokens: ${logEntry.total_tokens} (P: ${logEntry.prompt_tokens}, C: ${logEntry.completion_tokens}) | Cost: $${logEntry.cost}`);

  try {
    const dir = "./logs";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(path.join(dir, "token-usage.jsonl"), JSON.stringify(logEntry) + "\n", "utf8");
  } catch (err) {
    console.error("Failed to write token usage log:", err);
  }
}

async function callGroqFallback(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment.");
  }
  const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
  const model = options.model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  console.log(`[Groq Fallback] Routing request to Groq using model: ${model}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
      response_format: options.response_format
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Invalid Groq response structure: ${JSON.stringify(data)}`);
  }

  // If JSON format is expected, validate it is parseable
  if (options.response_format?.type === "json_object") {
    try {
      const clean = content
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      JSON.parse(clean);
    } catch (e) {
      throw new Error(`Groq returned invalid JSON structure when json_object was requested: ${content}`);
    }
  }

  // Log usage details (Groq model costs are calculated as $0 locally or skipped)
  if (data.usage) {
    logTokenUsage(`groq/${model}`, data.usage, 0);
  }

  return content;
}

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in environment.");
  }

  // Try OpenRouter first
  try {
    // Pacing delay (500ms) to prevent bombarding the API and hitting 429 rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));

    const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    let model = options.model || process.env.OPENROUTER_MODEL || "openrouter/free";
    const referer = process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000";
    const title = process.env.OPENROUTER_APP_TITLE || "Daily DSA Intuition Builder";

    const maxRetries = 3;
    let attempt = 0;
    let delay = 2000;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": referer,
            "X-Title": title
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1500,
            response_format: options.response_format
          })
        });

        // Handle rate limits (429) or server errors (5xx)
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          const errorText = await response.text();
          console.warn(`Attempt ${attempt}/${maxRetries} got status ${response.status}. Response: ${errorText}. Retrying in ${delay}ms...`);
          
          // Switch to the fallback model openrouter/free
          const fallbackModel = "openrouter/free";
          if (model !== fallbackModel) {
            console.warn(`Switching model from ${model} to ${fallbackModel} due to status ${response.status}.`);
            model = fallbackModel;
            // Dynamically override the env variable so future calls remember the switch
            process.env.OPENROUTER_MODEL = fallbackModel;
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2.5; // Exponential backoff factor
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = (await response.json()) as any;

        // Log token usage and cost metadata
        if (data?.usage) {
          logTokenUsage(model, data.usage, data.cost);
        }

        let content = data?.choices?.[0]?.message?.content;
        
        // Fallback for reasoning models where content is null but reasoning is populated
        if (!content && data?.choices?.[0]?.message?.reasoning) {
          content = data.choices[0].message.reasoning;
        }
        
        if (!content) {
          throw new Error(`Invalid OpenRouter response structure (empty content/reasoning): ${JSON.stringify(data)}`);
        }

        // If JSON format is expected, validate it is parseable
        if (options.response_format?.type === "json_object") {
          try {
            const clean = content
              .replace(/^```json\s*/i, "")
              .replace(/```\s*$/, "")
              .trim();
            JSON.parse(clean);
          } catch (e) {
            throw new Error(`Model returned invalid JSON structure when json_object was requested: ${content}`);
          }
        }

        return content;
      } catch (error) {
        console.warn(`Attempt ${attempt}/${maxRetries} failed with error: ${error}. Retrying in ${delay}ms...`);
        
        const fallbackModel = "openrouter/free";
        if (model !== fallbackModel) {
          console.warn(`Switching model from ${model} to ${fallbackModel} due to exception.`);
          model = fallbackModel;
          process.env.OPENROUTER_MODEL = fallbackModel;
        }

        if (attempt >= maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2.5;
      }
    }

    throw new Error("Failed to call OpenRouter after maximum retries.");
  } catch (openRouterError) {
    console.warn(`[API Fallback] OpenRouter calls failed or rate-limited. Activating Groq fallback...`);
    try {
      return await callGroqFallback(messages, options);
    } catch (groqError) {
      console.error(`[API Fallback] Groq fallback call also failed: ${groqError}`);
      throw new Error(`Both OpenRouter and Groq API calls failed. OpenRouter error: ${openRouterError}. Groq error: ${groqError}`);
    }
  }
}
