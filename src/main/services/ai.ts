/**
 * AI provider adapter — raw fetch, no SDKs.
 *
 * Supports OpenAI, Anthropic, and Ollama (local).
 * Each provider returns differently; we normalize to a plain string.
 */

interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiCompletionArgs {
  provider: "openai" | "anthropic" | "ollama";
  model: string;
  apiKey: string;
  baseUrl?: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export async function complete(args: AiCompletionArgs): Promise<string> {
  switch (args.provider) {
    case "openai": {
      return completeOpenAI(args);
    }
    case "anthropic": {
      return completeAnthropic(args);
    }
    case "ollama": {
      return completeOllama(args);
    }
  }
}

async function completeOpenAI(args: AiCompletionArgs): Promise<string> {
  const baseUrl = args.baseUrl || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      max_completion_tokens: args.maxTokens ?? 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message.content ?? "";
}

async function completeAnthropic(args: AiCompletionArgs): Promise<string> {
  const baseUrl = args.baseUrl || "https://api.anthropic.com/v1";

  // Anthropic uses a system prompt separately from messages
  const systemMsg = args.messages.find((m) => m.role === "system");
  const otherMsgs = args.messages.filter((m) => m.role !== "system");

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: args.model,
      system: systemMsg?.content,
      messages: otherMsgs.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: args.maxTokens ?? 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

async function completeOllama(args: AiCompletionArgs): Promise<string> {
  const baseUrl = args.baseUrl || "http://localhost:11434";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    message: { content: string };
  };
  return data.message.content ?? "";
}
