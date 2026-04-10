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

  return (
    <div className="border-border bg-bg-surface mx-3 my-1.5 max-w-xl overflow-hidden rounded-lg border shadow-sm">
      {startLine && startLine !== line && (
        <div className="bg-bg-raised border-border text-text-tertiary border-b px-3 py-1.5 font-mono text-[10px]">
          Lines {startLine}–{line}
        </div>
      )}
      <ReviewMarkdownComposer
        autoFocus
        className="rounded-none border-0 shadow-none"
        onChange={setBody}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment..."
        prNumber={prNumber}
        rows={4}
        value={body}
      />
      <div className="border-border flex items-center justify-between border-t px-3 py-2">
        <span className="text-text-ghost text-[10px]">
          {modKey}+Enter to submit · Esc to cancel
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className={`gap-1 ${
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
        <div className="border-border border-t px-3 py-1.5">
          <p className="text-destructive text-[11px]">
            {String(
              (createMutation.error as unknown as Error)?.message ?? "Failed to create comment",
            )}
          </p>
        </div>
      )}
    </div>
  );
}
