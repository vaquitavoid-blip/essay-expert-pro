/**
 * Handwriting transcription. Students photograph or scan a written answer; a
 * vision model reads it — including poor handwriting — and returns plain text
 * that the existing marker and AO coach consume unchanged.
 */
import { visionChat } from "../ai.server";

const MODEL_VISION = "google/gemini-3.6-flash";

const SYSTEM_PROMPT = [
  "You transcribe handwritten Cambridge AS/A Level Economics (9708) answers from photographs",
  "and scans. The handwriting is often rushed, slanted, cramped or faint.",
  "",
  "Rules:",
  "1. Transcribe EVERY word in reading order across all pages, joining pages into one answer.",
  "2. Do not correct, improve, shorten or rephrase anything — the mark depends on the student's",
  "   own wording. Keep their grammar and spelling mistakes exactly as written.",
  "3. Preserve paragraph breaks. Keep crossed-out text out of the transcript.",
  "4. Expand nothing except obvious economics shorthand written as symbols in prose",
  "   (e.g. an arrow used as 'leads to'), and keep standard notation as-is (P, Q, D, S, AD, AS).",
  "5. Where a word is genuinely illegible, output your best reading followed by [?].",
  "   Never invent sentences to fill a gap.",
  "6. Ignore printed question text, margins, page numbers and teacher annotations.",
  "",
  "Return ONLY the transcript as plain text. No preamble, no headings, no commentary.",
].join("\n");

export type TranscriptionOutcome = {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
};

export async function transcribeHandwritingImages(
  imageDataUrls: string[],
  hint?: string,
): Promise<TranscriptionOutcome> {
  const result = await visionChat({
    model: MODEL_VISION,
    systemPrompt: SYSTEM_PROMPT,
    prompt: [
      `Transcribe this handwritten answer (${imageDataUrls.length} page image${
        imageDataUrls.length === 1 ? "" : "s"
      }, in order).`,
      hint ? `Context for ambiguous words — the exam question is: ${hint}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    imageDataUrls,
  });

  const text = result.text.trim();
  if (text.length < 10) {
    throw new Error(
      "No handwriting could be read from those images. Try a brighter, straight-on photo of the full page.",
    );
  }

  return { ...result, text };
}
