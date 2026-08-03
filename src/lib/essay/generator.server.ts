/**
 * Perfect Cambridge essay generator — produces a model answer in the exact
 * structure an examiner rewards, grounded in the project knowledge base, with
 * the correct diagrams selected from the diagram library and an AO breakdown.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { chat } from "../ai.server";
import { DIAGRAM_IDS, DIAGRAM_INDEX_FOR_AI } from "../diagrams/catalog";
import { MODEL_EXAMINER, defaultSplitForMaxMark } from "../examiner/config";
import { extractFirstJsonObject } from "../examiner/json";
import { renderContext, retrieve } from "../retrieval.server";

export type EssaySectionKey =
  | "introduction"
  | "knowledge"
  | "analysis"
  | "application"
  | "evaluation"
  | "conclusion";

export type EssaySection = {
  key: EssaySectionKey;
  heading: string;
  paragraphs: string[];
  diagramIds: string[];
};

export type GeneratedEssay = {
  level: "as" | "a2";
  topic: string;
  question: string;
  maxMark: number;
  sections: EssaySection[];
  diagramIds: string[];
  estimatedMark: number;
  ao: { ao1: number; ao2: number; ao3: number };
  aoMax: { ao1: number; ao2: number; ao3: number };
  examinerComments: string[];
  markSchemeNotes: string[];
  keyTerms: { term: string; definition: string }[];
};

const SECTION_ORDER: { key: EssaySectionKey; heading: string }[] = [
  { key: "introduction", heading: "Introduction" },
  { key: "knowledge", heading: "Knowledge and understanding (AO1)" },
  { key: "analysis", heading: "Analysis (AO2)" },
  { key: "application", heading: "Application to context" },
  { key: "evaluation", heading: "Evaluation (AO3)" },
  { key: "conclusion", heading: "Conclusion — supported judgement" },
];

const CONTRACT = `
Return ONLY one JSON object with this shape:
{
  "sections": {
    "introduction": { "paragraphs": [string], "diagram_ids": [string] },
    "knowledge":    { "paragraphs": [string], "diagram_ids": [string] },
    "analysis":     { "paragraphs": [string], "diagram_ids": [string] },
    "application":  { "paragraphs": [string], "diagram_ids": [string] },
    "evaluation":   { "paragraphs": [string], "diagram_ids": [string] },
    "conclusion":   { "paragraphs": [string], "diagram_ids": [string] }
  },
  "estimated_mark": number,
  "ao": { "ao1": number, "ao2": number, "ao3": number },
  "examiner_comments": [string],
  "mark_scheme_notes": [string],
  "key_terms": [{ "term": string, "definition": string }]
}
`.trim();

export async function generatePerfectEssay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: { level: "as" | "a2"; topic: string; question: string; maxMark: number },
) {
  const split = defaultSplitForMaxMark(input.maxMark);

  let sources: Awaited<ReturnType<typeof retrieve>> = [];
  try {
    sources = await retrieve(supabase, {
      query: `${input.question} ${input.topic} — definitions, mechanisms, diagrams and evaluation`,
      matchCount: 10,
      docTypes: ["coursebook", "syllabus", "past_paper", "mark_scheme"],
    });
  } catch (error) {
    console.error("Essay generator retrieval failed", error);
  }

  const systemPrompt = [
    "You are a Cambridge International 9708 Economics principal examiner writing a full-mark model answer",
    input.level === "a2" ? "at A Level standard." : "at AS Level standard.",
    "",
    `The question is worth ${input.maxMark} marks with the fixed allocation AO1 = ${split.ao1_marks}, AO2 = ${split.ao2_marks}, AO3 = ${split.ao3_marks}.`,
    "",
    "House rules for the model answer:",
    "- Write in continuous examiner prose. No bullet lists inside paragraphs, no markdown, no headings inside the text.",
    "- Introduction: define the key terms from the question precisely and set out the line of argument in 2-3 sentences.",
    "- Knowledge: accurate syllabus definitions and theory, using Cambridge wording.",
    "- Analysis: explicit causal chains — cause, therefore, therefore, outcome — and describe the diagram movement in words",
    "  (which curve shifts, in which direction, and what happens to price/quantity or the price level/output).",
    "- Application: apply the theory to a real, named context or to the context in the question.",
    "- Evaluation: judgement supported by criteria — magnitude, elasticity, time period, counterfactual, assumptions,",
    "  distributional effects. Never a list of unweighted 'on the other hand' points.",
    "- Conclusion: an explicit supported judgement that answers the exact question asked, with the decisive criterion.",
    "",
    "Diagrams: choose from the library below and put the diagram id(s) in the diagram_ids of the section where they belong.",
    "Only ever use ids from this list, and only where a diagram genuinely earns marks (usually analysis, sometimes evaluation).",
    "Reference the diagram in the prose ('as the diagram shows, supply shifts right from S1 to S2') so the text and figure match.",
    "",
    "AVAILABLE DIAGRAMS:",
    DIAGRAM_INDEX_FOR_AI,
    "",
    sources.length > 0
      ? `Use the taught course material below for definitions, wording and examples:\n${renderContext(sources)}`
      : "",
    "",
    `estimated_mark must be out of ${input.maxMark}, and ao.ao1/ao2/ao3 must not exceed ${split.ao1_marks}/${split.ao2_marks}/${split.ao3_marks}.`,
    "examiner_comments explain, in examiner voice, why this answer reaches the top band.",
    "mark_scheme_notes list the specific points a mark scheme would credit.",
    "",
    CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = [
    `Level: ${input.level === "a2" ? "A Level" : "AS Level"}`,
    `Topic: ${input.topic}`,
    `Marks: ${input.maxMark}`,
    `Question: ${input.question}`,
  ].join("\n");

  const result = await chat({
    model: MODEL_EXAMINER,
    temperature: 0.3,
    json: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const raw = extractFirstJsonObject(result.text) ?? {};
  const rawSections = (raw.sections ?? {}) as Record<string, unknown>;

  const sections: EssaySection[] = SECTION_ORDER.map(({ key, heading }) => {
    const node = (rawSections[key] ?? {}) as Record<string, unknown>;
    const paragraphs = Array.isArray(node.paragraphs)
      ? node.paragraphs.map((p) => String(p).trim()).filter((p) => p.length > 0)
      : [];
    const diagramIds = Array.isArray(node.diagram_ids)
      ? node.diagram_ids.map((id) => String(id).trim()).filter((id) => DIAGRAM_IDS.includes(id))
      : [];
    return { key, heading, paragraphs, diagramIds };
  }).filter((section) => section.paragraphs.length > 0);

  const rawAo = (raw.ao ?? {}) as Record<string, unknown>;
  const clamp = (value: unknown, max: number) =>
    Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

  const ao = {
    ao1: clamp(rawAo.ao1, split.ao1_marks),
    ao2: clamp(rawAo.ao2, split.ao2_marks),
    ao3: clamp(rawAo.ao3, split.ao3_marks),
  };

  const stringList = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : [];

  const essay: GeneratedEssay = {
    level: input.level,
    topic: input.topic,
    question: input.question,
    maxMark: input.maxMark,
    sections,
    diagramIds: [...new Set(sections.flatMap((section) => section.diagramIds))],
    estimatedMark: Math.max(0, Math.min(input.maxMark, ao.ao1 + ao.ao2 + ao.ao3)),
    ao,
    aoMax: { ao1: split.ao1_marks, ao2: split.ao2_marks, ao3: split.ao3_marks },
    examinerComments: stringList(raw.examiner_comments),
    markSchemeNotes: stringList(raw.mark_scheme_notes),
    keyTerms: Array.isArray(raw.key_terms)
      ? raw.key_terms
          .map((item) => {
            const record = (item ?? {}) as Record<string, unknown>;
            return {
              term: String(record.term ?? "").trim(),
              definition: String(record.definition ?? "").trim(),
            };
          })
          .filter((item) => item.term.length > 0 && item.definition.length > 0)
      : [],
  };

  if (essay.sections.length === 0) {
    throw new Error("The examiner model did not return a usable essay. Please try again.");
  }

  return { essay, meta: result, sourceCount: sources.length };
}
