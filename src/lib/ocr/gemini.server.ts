/**
 * Handwriting OCR via the user's own Google AI Studio key — a direct call to
 * the Gemini API, deliberately bypassing the built-in AI gateway and its
 * credits. Pages are transcribed one at a time and joined in page order.
 */
const MODEL = "models/gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

const SYSTEM_PROMPT =
  "You are an OCR engine specialised in Cambridge examination papers. Read handwritten English exactly as written. Preserve spelling mistakes, grammar mistakes, punctuation and line breaks. Never improve or rewrite the student's wording. If a word cannot be confidently read, replace only that word with [?]. Do not summarise. Do not explain. Output only the transcription.";

export type PageTranscription = {
  page: number;
  text: string | null;
};

export type GeminiOcrOutcome = {
  text: string;
  model: string;
  pages: number;
  failedPages: number[];
  latencyMs: number;
};

/** The Google AI Studio key an admin saved in the app. */
async function getGoogleApiKey(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ai_provider_keys")
    .select("api_key, is_active")
    .eq("provider", "google")
    .order("is_active", { ascending: false })
    .limit(1)
    .maybeSingle();

  const key = data?.api_key?.trim();
  if (!key) {
    throw new Error(
      "No Google AI Studio API key is configured. Add one in the admin console under AI providers.",
    );
  }
  return key;
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("A page image was not a valid base64 image.");
  return { mimeType: match[1]!, data: match[2]! };
}

async function transcribePage(apiKey: string, dataUrl: string): Promise<string> {
  const { mimeType, data } = splitDataUrl(dataUrl);

  const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data } },
            {
              text: "Transcribe the handwriting on this page exactly as written. Ignore page numbers and printed exam instructions.",
            },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini returned ${response.status}. ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini returned no text for this page.");
  return text;
}

export async function transcribeWithGemini(
  imageDataUrls: string[],
  _hint?: string,
): Promise<GeminiOcrOutcome> {
  const apiKey = await getGoogleApiKey();
  const startedAt = Date.now();
  const results: PageTranscription[] = [];

  for (let index = 0; index < imageDataUrls.length; index++) {
    const dataUrl = imageDataUrls[index]!;
    let text: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        text = await transcribePage(apiKey, dataUrl);
        break;
      } catch (error) {
        if (attempt === 1) {
          console.error(`Gemini OCR failed on page ${index + 1}`, error);
        }
      }
    }
    results.push({ page: index + 1, text });
  }

  const failedPages = results.filter((page) => !page.text).map((page) => page.page);
  const text = results
    .filter((page) => page.text)
    .map((page) => page.text!.trim())
    .join("\n\n");

  if (!text) {
    throw new Error(
      "No handwriting could be read from those pages. Try a brighter, straight-on photo of the full page.",
    );
  }

  return {
    text,
    model: MODEL,
    pages: results.length,
    failedPages,
    latencyMs: Date.now() - startedAt,
  };
}
