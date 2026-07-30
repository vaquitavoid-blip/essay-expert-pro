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

/** Gemini stays the primary LLM, exactly as in the original pipeline. */
export const MODEL_EXAMINER = "google/gemini-2.5-pro";
export const MODEL_FAST = "google/gemini-2.5-flash";
export const MODEL_EMBEDDING = "google/gemini-embedding-2";
export const EMBEDDING_DIMS = 3072;

/**
 * Well-known AO splits by question tariff. Used as a sane default when the
 * caller does not pass an explicit split; a mismatched split is always an
 * error rather than silently redistributed.
 */
export function defaultSplitForMaxMark(maxMark: number): AoSplit {
  switch (maxMark) {
    case 8:
      return { ao1_marks: 2, ao2_marks: 6, ao3_marks: 0 };
    case 12:
      return { ...DEFAULT_AO_SPLIT };
    case 20:
      return { ao1_marks: 4, ao2_marks: 8, ao3_marks: 8 };
    case 25:
      return { ao1_marks: 5, ao2_marks: 10, ao3_marks: 10 };
    default: {
      // Proportional fallback that still sums exactly to maxMark.
      const ao1 = Math.max(1, Math.round(maxMark * (2 / 12)));
      const ao2 = Math.max(1, Math.round(maxMark * (6 / 12)));
      return { ao1_marks: ao1, ao2_marks: ao2, ao3_marks: maxMark - ao1 - ao2 };
    }
  }
}