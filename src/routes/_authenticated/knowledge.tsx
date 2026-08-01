import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { extractTextFromFile } from "@/lib/extract-text";
import { getMe } from "@/lib/account.functions";
import {
  deleteDocument,
  embedNextBatch,
  ingestDocument,
  listDocuments,
  searchKnowledge,
} from "@/lib/knowledge.functions";

const DOC_TYPES = [
  { value: "coursebook", label: "Coursebook" },
  { value: "syllabus", label: "Syllabus" },
  { value: "mark_scheme", label: "Mark scheme" },
  { value: "past_paper", label: "Past paper" },
  { value: "examiner_report", label: "Examiner report" },
  { value: "notes", label: "Class notes" },
  { value: "other", label: "Other" },
] as const;

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge base — Marginal Economics" },
      {
        name: "description",
        content:
          "Upload your Economics coursebook, syllabus, mark schemes and examiner reports so every essay is marked against your own materials.",
      },
      { property: "og:title", content: "Knowledge base — Marginal Economics" },
      {
        property: "og:description",
        content: "Add PDFs and notes that ground every mark in real Cambridge source material.",
      },
    ],
  }),
  component: KnowledgePage,
});

type Stage = { phase: "idle" | "reading" | "chunking" | "embedding"; value: number; label: string };

function KnowledgePage() {
  const queryClient = useQueryClient();
  const fetchMe = useServerFn(getMe);
  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const ingest = useServerFn(ingestDocument);
  const embedBatch = useServerFn(embedNextBatch);
  const removeDoc = useServerFn(deleteDocument);
  const fetchDocs = useServerFn(listDocuments);
  const search = useServerFn(searchKnowledge);

  const docs = useQuery({ queryKey: ["documents"], queryFn: () => fetchDocs() });

  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("coursebook");
  const [examSeries, setExamSeries] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ phase: "idle", value: 0, label: "" });

  const [query, setQuery] = useState("");
  const searchMutation = useMutation({
    mutationFn: (value: string) => search({ data: { query: value } }),
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = stage.phase !== "idle";

  const isStaff = me.data?.isStaff ?? false;

  const reset = () => {
    setTitle("");
    setExamSeries("");
    setPastedText("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setStage({ phase: "idle", value: 0, label: "" });
  };

  const handleUpload = async () => {
    try {
      let text = pastedText.trim();

      if (file) {
        setStage({ phase: "reading", value: 5, label: "Reading file…" });
        text = await extractTextFromFile(file, (page, total) => {
          setStage({
            phase: "reading",
            value: Math.round((page / total) * 40),
            label: `Reading page ${page} of ${total}…`,
          });
        });
      }

      if (text.length < 200) {
        throw new Error(
          "Not enough readable text. Scanned PDFs need to be OCR'd first — or paste the text in directly.",
        );
      }

      setStage({ phase: "chunking", value: 45, label: "Splitting into searchable sections…" });

      const result = await ingest({
        data: {
          title: title.trim() || file?.name.replace(/\.[^.]+$/, "") || "Untitled document",
          docType: docType as (typeof DOC_TYPES)[number]["value"],
          sourceName: file?.name,
          examSeries: examSeries.trim() || undefined,
          text,
        },
      });

      if (result.duplicateOf) {
        toast.info(`Already in your library as "${result.duplicateOf}".`);
        reset();
        return;
      }

      // Embedding runs in server-side batches; drive it to completion here so
      // the progress bar reflects real work rather than a guess.
      let done = false;
      let embedded = 0;
      while (!done) {
        const batch = await embedBatch({ data: { documentId: result.documentId } });
        embedded += batch.embedded;
        done = batch.done;
        const total = embedded + batch.remaining;
        setStage({
          phase: "embedding",
          value: 50 + Math.round((embedded / Math.max(total, 1)) * 50),
          label: `Indexing ${embedded} of ${total} sections…`,
        });
      }

      toast.success(`"${title || file?.name}" is ready and will now ground your marking.`);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
      setStage({ phase: "idle", value: 0, label: "" });
    }
  };

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Add your coursebook, the 9708 syllabus, mark schemes and examiner reports. Every mark is then grounded in these documents and cited back to them."
      />

      {me.isLoading ? null : !isStaff ? (
        <div className="px-5 py-16 md:px-8">
          <div className="panel mx-auto max-w-md px-6 py-10 text-center">
            <h2 className="text-sm font-semibold">Teachers only</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The shared knowledge library is managed by your teachers. Everything in it already
              grounds your marking, MCQ papers and coaching automatically.
            </p>
          </div>
        </div>
      ) : (

      <div className="grid gap-6 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="panel space-y-4 p-5">
            <h2 className="text-sm font-semibold">Add a document</h2>

            <div className="space-y-1.5">
              <Label htmlFor="file">PDF or text file</Label>
              <Input
                id="file"
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
                }}
              />
              <p className="text-xs text-muted-foreground">
                Large coursebooks are fine — pages are read in your browser and indexed in batches.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                disabled={busy}
                placeholder="Cambridge International AS & A Level Economics Coursebook"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="docType">Type</Label>
                <Select value={docType} onValueChange={setDocType} disabled={busy}>
                  <SelectTrigger id="docType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="series">Series (optional)</Label>
                <Input
                  id="series"
                  value={examSeries}
                  disabled={busy}
                  placeholder="Nov 2024"
                  onChange={(event) => setExamSeries(event.target.value)}
                />
              </div>
            </div>

            {!file ? (
              <div className="space-y-1.5">
                <Label htmlFor="paste">Or paste text</Label>
                <Textarea
                  id="paste"
                  rows={5}
                  disabled={busy}
                  placeholder="Paste syllabus sections, mark scheme wording or class notes…"
                  value={pastedText}
                  onChange={(event) => setPastedText(event.target.value)}
                />
              </div>
            ) : null}

            {busy ? (
              <div className="space-y-2">
                <Progress value={stage.value} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{stage.label}</p>
              </div>
            ) : null}

            <Button
              className="w-full"
              disabled={busy || (!file && pastedText.trim().length < 200)}
              onClick={handleUpload}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Working…
                </>
              ) : (
                <>
                  <Upload className="size-4" /> Add to knowledge base
                </>
              )}
            </Button>
          </div>

          <div className="panel space-y-3 p-5">
            <h2 className="text-sm font-semibold">Test retrieval</h2>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. evaluation of price ceilings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && query.trim().length > 1) {
                    searchMutation.mutate(query.trim());
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={query.trim().length < 2 || searchMutation.isPending}
                onClick={() => searchMutation.mutate(query.trim())}
              >
                {searchMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
              </Button>
            </div>
            {searchMutation.data?.length ? (
              <ul className="space-y-2.5">
                {searchMutation.data.map((hit, index) => (
                  <li key={index} className="rounded-md border border-border p-3">
                    <p className="text-xs font-medium">
                      {hit.documentTitle}
                      {hit.heading ? ` — ${hit.heading}` : ""}{" "}
                      <span className="text-muted-foreground">
                        ({Math.round(hit.similarity * 100)}%)
                      </span>
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{hit.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : searchMutation.isSuccess ? (
              <p className="text-xs text-muted-foreground">No matches yet — add more documents.</p>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Library</h2>
          </div>

          {docs.isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (docs.data?.length ?? 0) === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              Nothing here yet. Start with the 9708 syllabus and your coursebook.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {docs.data?.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {doc.doc_type.replace(/_/g, " ")} · {doc.chunk_count} sections ·{" "}
                      {Math.round(doc.char_count / 1000)}k characters
                      {doc.exam_series ? ` · ${doc.exam_series}` : ""}
                    </p>
                    {doc.error_message ? (
                      <p className="mt-1 text-xs text-destructive">{doc.error_message}</p>
                    ) : null}
                  </div>
                  <Badge
                    variant={
                      doc.status === "ready"
                        ? "default"
                        : doc.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {doc.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      try {
                        await removeDoc({ data: { id: doc.id } });
                        queryClient.invalidateQueries({ queryKey: ["documents"] });
                        toast.success("Removed.");
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? "Only teachers and admins can remove documents."
                            : "Delete failed.",
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}
    </>
  );
}