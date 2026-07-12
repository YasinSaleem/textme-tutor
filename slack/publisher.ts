export async function postSlackMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const body: any = { channel, text };
  if (threadTs) {
    body.thread_ts = threadTs;
  }
  
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Slack HTTP error: ${response.status} - ${err}`);
  }

  const json = (await response.json()) as any;
  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error}`);
  }

  return json.ts as string; // returns message timestamp
}

export async function getSlackThreadHistory(
  token: string,
  channel: string,
  threadTs: string
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const url = `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Slack replies HTTP error: ${response.status} - ${err}`);
  }

  const json = (await response.json()) as any;
  if (!json.ok) {
    throw new Error(`Slack replies API error: ${json.error}`);
  }

  const messages: any[] = json.messages || [];
  return messages.map((m) => {
    const isBot = m.bot_id || m.subtype === "bot_message";
    return {
      role: isBot ? "assistant" : "user",
      text: m.text || ""
    };
  });
}
