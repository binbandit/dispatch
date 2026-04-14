import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation } from "@tanstack/react-query";
import { CornerDownLeft } from "lucide-react";
import { useState } from "react";

/**
 * Comment composer — inline card for creating new review comments.
 *
 * Renders inside a `<td colSpan={3}>` in the diff table.
 * - Cmd/Ctrl+Enter to submit, Escape to cancel
 */

interface CommentComposerProps {
  prNumber: number;
  filePath: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  onClose: () => void;
}

export function CommentComposer({
  prNumber,
  filePath,
  line,
  side,
  startLine,
  onClose,
}: CommentComposerProps) {
  const { repoTarget } = useWorkspace();
  const [body, setBody] = useState("");

  const createMutation = useMutation({
    mutationFn: (args: {
      body: string;
      path: string;
      line: number;
      side: "LEFT" | "RIGHT";
      startLine?: number;
      startSide?: "LEFT" | "RIGHT";
    }) => ipc("pr.createComment", { ...repoTarget, prNumber, ...args }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      toastManager.add({ title: "Comment added", type: "success" });
      onClose();
    },
    onError: (err: Error) => {
      toastManager.add({
        title: "Comment failed",
        description: err.message,
        type: "error",
      });
    },
  });

  function handleSubmit() {
    if (!body.trim()) {
      return;
    }
    createMutation.mutate({
      body: body.trim(),
      path: filePath,
      line,
      side,
      startLine,
      startSide: startLine && startLine !== line ? side : undefined,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const isMac = navigator.platform.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";
  const isMultiLine = startLine && startLine !== line;

  return (
    <div className="border-border mx-3 my-2 max-w-[46rem] overflow-hidden rounded-[10px] border bg-[linear-gradient(180deg,var(--comment-card-from),var(--comment-card-to))] shadow-[var(--comment-card-shadow)]">
      <div className="border-border-subtle flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="border-border-accent bg-accent-muted text-accent-text inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px]">
          New comment
        </span>
        <span className="text-text-tertiary text-[10px]">
          {isMultiLine ? `Commenting on lines ${startLine}–${line}` : `Commenting on line ${line}`}
        </span>
        <span className="text-text-ghost ml-auto truncate font-mono text-[10px]">{filePath}</span>
      </div>
      {isMultiLine && (
        <div className="bg-bg-root/70 border-border-subtle border-b px-3 py-1.5">
          <span className="text-text-tertiary font-mono text-[10px]">
            Range anchored on the {side === "RIGHT" ? "new" : "old"} side of the diff
          </span>
        </div>
      )}
      <ReviewMarkdownComposer
        autoFocus
        className="rounded-none border-0 bg-transparent shadow-none"
        onChange={setBody}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment…"
        prNumber={prNumber}
        rows={4}
        value={body}
      />
      <div className="border-border-subtle flex items-center justify-between gap-2 border-t px-3 py-2.5">
        <span className="text-text-ghost font-mono text-[10px]">
          {modKey}+Enter to submit · Esc to cancel
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={createMutation.isPending}
            className="text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className={`gap-1 text-[11px] ${
              body.trim()
                ? "bg-primary text-bg-root hover:bg-accent-hover"
                : "bg-bg-raised text-text-tertiary"
            }`}
            onClick={handleSubmit}
            disabled={!body.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <CornerDownLeft size={11} />
            )}
            Comment
          </Button>
        </div>
      </div>
      {createMutation.isError && (
        <div className="border-border-subtle border-t px-3 py-2">
          <p className="text-destructive text-[11px]">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : "Could not add the comment."}
          </p>
        </div>
      )}
    </div>
  );
}
