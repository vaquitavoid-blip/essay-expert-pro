// Server-only Lovable AI Gateway client. Gemini stays the primary LLM.
// LOVABLE_API_KEY must never reach the browser.

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

import type { ProviderConfig } from "./ai/active.server";
import { getActiveProvider } from "./ai/active.server";

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
  if (status === 402)
    return "AI credits have run out. An admin can add credits, or plug in their own provider key (Claude, Gemini, Grok, OpenAI…) under Admin → AI providers.";
  if (status === 401)
    return "The configured AI provider rejected the API key. An admin can update it under Admin → AI providers.";
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
  /** GPT-5 family: must be sent explicitly, and "none" keeps marking fast. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Bypass the stored override (used by the admin "test key" action). */
  overrideProvider?: ProviderConfig | null;
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
  const override =
    options.overrideProvider !== undefined ? options.overrideProvider : await getActiveProvider();

  if (override) {
    const result = await chatViaProvider(override, options);
    return { ...result, latencyMs: Date.now() - started };
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (options.json) body.response_format = { type: "json_object" };
  if (options.maxCompletionTokens) body.max_completion_tokens = options.maxCompletionTokens;
  if (options.model.startsWith("openai/gpt-5")) {
    body.reasoning_effort = options.reasoningEffort ?? "none";
    // GPT-5 models reject a non-default temperature on chat completions.
    delete body.temperature;
  }

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

/**
 * Bring-your-own-key path. Anthropic has its own request shape; every other
 * supported provider accepts the OpenAI chat-completions body.
 */
async function chatViaProvider(
  config: ProviderConfig,
  options: ChatOptions,
): Promise<Omit<ChatResult, "latencyMs">> {
  if (config.provider === "anthropic") {
    const system = options.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const response = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: options.maxCompletionTokens ?? 8000,
        ...(system ? { system } : {}),
        ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
        messages: options.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new AiGatewayError(explain(response.status, await response.text()), response.status);
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: (data.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
      model: config.model,
      promptTokens: data.usage?.input_tokens ?? null,
      completionTokens: data.usage?.output_tokens ?? null,
    };
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
  };
  if (typeof options.temperature === "number" && !/^gpt-5/.test(config.model)) {
    body.temperature = options.temperature;
  }
  if (options.json) body.response_format = { type: "json_object" };
  if (options.maxCompletionTokens) body.max_completion_tokens = options.maxCompletionTokens;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
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
    model: config.model,
    promptTokens: data.usage?.prompt_tokens ?? null,
    completionTokens: data.usage?.completion_tokens ?? null,
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

/**
 * Multimodal read of one or more page images (scans/photos of handwriting).
 * Always goes through the Lovable gateway: a bring-your-own text-only provider
 * key cannot read images, and transcription must never silently fail.
 */
export async function visionChat(options: {
  model: string;
  systemPrompt: string;
  prompt: string;
  imageDataUrls: string[];
}): Promise<ChatResult> {
  const started = Date.now();

  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            ...options.imageDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
    }),
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