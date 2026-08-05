// Ported from the original Python `config.py`. Central tunables so no agent
// or route hardcodes marking values.

export const SYLLABUS_CODE = "9708";

export const DEFAULT_MAX_MARK = 12;

/** Standard 12-mark evaluative essay split for syllabus 9708. NOT an even third. */
export const DEFAULT_AO_SPLIT = {
  ao1_marks: 2, // Knowledge and understanding
  ao2_marks: 6, // Analysis
  ao3_marks: 4, // Evaluation
} as const;

export type AoSplit = { ao1_marks: number; ao2_marks: number; ao3_marks: number };

/** Near-zero variance: consistent, reliable grading. */
export const TEMPERATURE_EXAMINER = 0;
export const TEMPERATURE_TUTOR = 0.4;

export const MAX_ANCHORS_PER_BAND = 2;

/**
 * Marking runs two sequential passes (examiner + independent audit), so the
 * examiner model is chosen for latency as well as judgement — the original
 * Gemini Pro pipeline pushed a single submission past a minute.
 */
export const MODEL_EXAMINER = "openai/gpt-5.6-sol";
export const MODEL_FAST = "openai/gpt-5.6-sol";
export const MODEL_EMBEDDING = "google/gemini-embedding-2";
export const EMBEDDING_DIMS = 3072;

/**
 * AO split by question tariff. Cambridge weights an evaluative essay
 * 2 knowledge : 6 analysis : 4 evaluation, so every tariff keeps that same
 * 2:6:4 weighting rather than an even three-way split. A 12-mark essay is
 * therefore exactly AO1 2 / AO2 6 / AO3 4.
 */
export function defaultSplitForMaxMark(maxMark: number): AoSplit {
  if (maxMark === 12) return { ...DEFAULT_AO_SPLIT };

  // Keep the 2:6:4 weighting and make the parts sum exactly to the tariff.
  const ao1 = Math.max(1, Math.round(maxMark * (2 / 12)));
  const ao2 = Math.max(1, Math.round(maxMark * (6 / 12)));
  const ao3 = maxMark - ao1 - ao2;
  if (ao3 >= 1) return { ao1_marks: ao1, ao2_marks: ao2, ao3_marks: ao3 };
  // Very small tariffs: protect evaluation before analysis.
  return { ao1_marks: ao1, ao2_marks: Math.max(1, maxMark - ao1 - 1), ao3_marks: 1 };
}