import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { InlineMetaBadge } from "@/renderer/components/review/comments/inline-meta-badge";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

export function ReplyComposer({
  prNumber,
  commentId,
  onClose,
}: {
  prNumber: number;
  commentId: number;
  onClose: () => void;
}) {
  const { repoTarget } = useWorkspace();
  const [body, setBody] = useState("");
  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  const replyMutation = useMutation({
    mutationFn: (args: { body: string }) =>
      ipc("pr.replyToComment", { ...repoTarget, prNumber, commentId, ...args }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      toastManager.add({ title: "Reply added", type: "success" });
      setBody("");
      onClose();
    },
    onError: (err: Error) => {
      toastManager.add({ title: "Reply failed", description: err.message, type: "error" });
    },
  });

  return (
    <div className="bg-bg-root/70 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <InlineMetaBadge className="border-[var(--border-accent)] bg-[var(--accent-muted)] text-[var(--accent-text)]">
          Reply
        </InlineMetaBadge>
        <span className="text-text-tertiary text-[10px]">
          Add context to the current review thread.
        </span>
      </div>
      <ReviewMarkdownComposer
        allowSuggestion
        autoFocus
        compact
        className="border-border-subtle bg-[linear-gradient(180deg,var(--comment-card-from),var(--comment-card-to))] shadow-none"
        onChange={setBody}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            replyMutation.mutate({ body: body.trim() });
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Write a reply…"
        prNumber={prNumber}
        rows={3}
        value={body}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-text-ghost font-mono text-[10px]">{modKey}+Enter to reply</span>
        <Button
          size="xs"
          variant="ghost"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          className="bg-primary text-primary-foreground hover:bg-accent-hover"
          disabled={!body.trim() || replyMutation.isPending}
          onClick={() => replyMutation.mutate({ body: body.trim() })}
        >
          {replyMutation.isPending ? <Spinner className="h-3 w-3" /> : "Reply"}
        </Button>
      </div>
    </div>
  );
}
