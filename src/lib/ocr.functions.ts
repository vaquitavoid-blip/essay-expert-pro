import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TranscribeInput = z.object({
  /** Page images as data URLs, in reading order. */
  images: z
    .array(z.string().startsWith("data:image/", "Each page must be an image."))
    .min(1, "Add at least one page image.")
    .max(12, "Up to 12 pages at a time."),
  hint: z.string().trim().max(2000).optional(),
});

/** Read a handwritten answer into plain text for marking or AO coaching. */
export const transcribeHandwriting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { transcribeHandwritingImages } = await import("./ocr/handwriting.server");

    try {
      const outcome = await transcribeHandwritingImages(data.images, data.hint);

      await supabase.from("ai_usage_log").insert({
        user_id: userId,
        feature: "transcribe_handwriting",
        model: outcome.model,
        prompt_tokens: outcome.promptTokens,
        completion_tokens: outcome.completionTokens,
        latency_ms: outcome.latencyMs,
        ok: true,
      });

      return { text: outcome.text, pages: data.images.length };
    } catch (error) {
      await supabase.from("ai_usage_log").insert({
        user_id: userId,
        feature: "transcribe_handwriting",
        model: "google/gemini-3.6-flash",
        ok: false,
        error_message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  });
