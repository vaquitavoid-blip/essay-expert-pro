import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { filesToPageImages } from "@/lib/handwriting-images";
import { transcribeHandwriting } from "@/lib/ocr.functions";

/**
 * Photograph-or-scan input for handwritten answers. Rasterises pages in the
 * browser, transcribes them, and hands plain text back to whichever writing
 * surface asked for it (essay marking or the AO skills coach).
 */
export function HandwritingUpload({
  hint,
  label = "Upload handwritten answer",
  onText,
}: {
  hint?: string;
  label?: string;
  onText: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<string | null>(null);
  const transcribe = useServerFn(transcribeHandwriting);

  const mutation = useMutation({
    mutationFn: async (files: File[]) => {
      setStage("Preparing pages…");
      const images = await filesToPageImages(files);
      setStage(`Reading ${images.length} page${images.length === 1 ? "" : "s"} of handwriting…`);
      return transcribe({ data: { images, hint: hint?.trim() || undefined } });
    },
    onSuccess: (result) => {
      onText(result.text);
      toast.success(
        `Transcribed ${result.pages} page${result.pages === 1 ? "" : "s"} — check it before marking.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setStage(null),
  });

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Handwritten answer</p>
          <p className="text-[11px] text-muted-foreground">
            Photo or PDF scan, up to 12 pages. Messy handwriting is fine.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => input.current?.click()}
        >
          {mutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ScanLine className="size-4" />
          )}
          {label}
        </Button>
      </div>

      {stage ? <p className="text-[11px] text-muted-foreground">{stage}</p> : null}

      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) mutation.mutate(files);
        }}
      />
    </div>
  );
}
