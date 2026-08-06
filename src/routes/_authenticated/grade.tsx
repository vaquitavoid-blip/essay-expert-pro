import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { HandwritingUpload } from "@/components/app/handwriting-upload";
import { MarkBreakdown } from "@/components/app/mark-breakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gradeEssaySubmission } from "@/lib/grading.functions";
import type { Grading } from "@/lib/examiner/types";

export const Route = createFileRoute("/_authenticated/grade")({
  head: () => ({
    meta: [
      { title: "Mark an essay — Marginal Economics" },
      {
        name: "description",
        content:
          "Submit a Cambridge 9708 Economics essay and get an examiner-standard mark with AO1, AO2 and AO3 breakdown plus rewrite guidance.",
      },
      { property: "og:title", content: "Mark an essay — Marginal Economics" },
      {
        property: "og:description",
        content: "Examiner-standard marking with a full assessment-objective breakdown.",
      },
    ],
  }),
  component: GradePage,
});

function GradePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const grade = useServerFn(gradeEssaySubmission);

  const [question, setQuestion] = useState("");
  const [essayText, setEssayText] = useState("");
  const [maxMark, setMaxMark] = useState("12");
  const [useAnchors, setUseAnchors] = useState(true);
  const [auditPass, setAuditPass] = useState(true);
  const [useRetrieval, setUseRetrieval] = useState(true);
  const [result, setResult] = useState<{ grading: Grading; essayId: string | null } | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      grade({
        data: {
          question,
          essayText,
          maxMark: Number(maxMark),
          useAnchors,
          auditPass,
          useRetrieval,
        },
      }),
    onSuccess: (data) => {
      setResult({ grading: data.grading as Grading, essayId: data.essayId });
      queryClient.invalidateQueries({ queryKey: ["essays"] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      toast.success(`Marked ${data.grading.total_mark}/${data.grading.max_mark}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const words = essayText.trim() ? essayText.trim().split(/\s+/).length : 0;

  return (
    <>
      <PageHeader
        title="Mark an essay"
        description="Marked to Cambridge 9708 standards, grounded in your own coursebook and mark schemes, then independently audited for central-tendency bias."
      />

      <div className="grid gap-6 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="panel space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="question">Exam question</Label>
            <Textarea
              id="question"
              rows={3}
              placeholder="Discuss whether a rise in the minimum wage will always reduce employment."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="maxMark">Marks available</Label>
            <Select value={maxMark} onValueChange={setMaxMark}>
              <SelectTrigger id="maxMark">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8 marks (AS data response)</SelectItem>
                <SelectItem value="12">12 marks (AS essay)</SelectItem>
                <SelectItem value="20">20 marks (A Level essay)</SelectItem>
                <SelectItem value="25">25 marks (A Level extended)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="essay">Your answer</Label>
              <span className="text-xs text-muted-foreground">{words} words</span>
            </div>
            <Textarea
              id="essay"
              rows={16}
              className="font-mono text-[13px] leading-relaxed"
              placeholder="Paste or type your full essay here…"
              value={essayText}
              onChange={(event) => setEssayText(event.target.value)}
            />
          </div>

          <HandwritingUpload
            hint={question}
            onText={(text) =>
              setEssayText((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text))
            }
          />

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <Toggle
              label="Independent audit pass"
              hint="A second examiner re-checks the mark to correct clustering around the middle bands."
              checked={auditPass}
              onChange={setAuditPass}
            />
            <Toggle
              label="Calibration anchors"
              hint="Anchor the standard to teacher-verified essays with confirmed marks."
              checked={useAnchors}
              onChange={setUseAnchors}
            />
            <Toggle
              label="Ground in knowledge base"
              hint="Retrieve syllabus, coursebook and mark scheme extracts before marking."
              checked={useRetrieval}
              onChange={setUseRetrieval}
            />
          </div>

          <Button
            className="w-full"
            disabled={mutation.isPending || question.trim().length < 10 || words < 20}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Marking — this takes up to a minute
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Mark this essay
              </>
            )}
          </Button>
        </div>

        <div>
          {result ? (
            <div className="space-y-4">
              <MarkBreakdown grading={result.grading} />
              {result.essayId ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigate({ to: "/essay/$essayId", params: { essayId: result.essayId! } })
                  }
                >
                  Open full report and rewrite
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="panel flex h-full min-h-64 flex-col items-center justify-center p-8 text-center">
              <Sparkles className="size-6 text-muted-foreground" />
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                Your mark, AO breakdown, missing elements and rewrite plan will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}