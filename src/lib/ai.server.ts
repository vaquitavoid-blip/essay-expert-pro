// Server-only Lovable AI Gateway client. Gemini stays the primary LLM.
// LOVABLE_API_KEY must never reach the browser.

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export class AiGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

function apiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new AiGatewayError("AI is not configured on this server.", 500);
  return key;
}

/** Maps gateway failures onto messages that are safe and useful in the UI. */
function explain(status: number, body: string): string {
  if (status === 429) return "The AI is rate limited right now. Please try again in a moment.";
  if (status === 402) return "AI credits have run out. Add credits to continue using AI features.";
  if (status === 403) return "AI access is disabled for this workspace.";
  return `The AI request failed (${status}). ${body.slice(0, 300)}`;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  json?: boolean;
  maxCompletionTokens?: number;
};

export type ChatResult = {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
};

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (options.json) body.response_format = { type: "json_object" };
  if (options.maxCompletionTokens) body.max_completion_tokens = options.maxCompletionTokens;

  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new AiGatewayError(explain(response.status, await response.text()), response.status);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model: options.model,
    promptTokens: data.usage?.prompt_tokens ?? null,
    completionTokens: data.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - started,
  };
}

/** Streaming chat used by the AI tutor. Yields text deltas. */
export async function streamChat(options: ChatOptions): Promise<Response> {
  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new AiGatewayError(explain(response.status, await response.text()), response.status);
  }
  return response;
}

const EMBED_BATCH_LIMIT = 100; // Google embedding models reject larger batches.

/**
 * Embed a list of texts. Splits into provider-safe batches and reassembles
 * by index so every input gets a vector — nothing is silently dropped.
 */
export async function embed(inputs: string[], model: string): Promise<number[][]> {
  const vectors: number[][] = new Array(inputs.length);

  for (let offset = 0; offset < inputs.length; offset += EMBED_BATCH_LIMIT) {
    const batch = inputs.slice(offset, offset + EMBED_BATCH_LIMIT);
    const response = await fetch(`${GATEWAY}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey(),
      },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!response.ok) {
      throw new AiGatewayError(explain(response.status, await response.text()), response.status);
    }

    const data = (await response.json()) as {
      data?: { index: number; embedding: number[] }[];
    };
    for (const item of data.data ?? []) {
      vectors[offset + item.index] = item.embedding;
    }
  }

  return vectors;
}

export async function embedOne(input: string, model: string): Promise<number[]> {
  const [vector] = await embed([input], model);
  if (!vector) throw new AiGatewayError("The AI returned no embedding.", 500);
  return vector;
}