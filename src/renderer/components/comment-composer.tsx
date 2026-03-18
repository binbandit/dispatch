import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Comment composer — inline textarea for creating new review comments.
 *
 * Triggered when user clicks a line's gutter in the diff viewer.
 * - Cmd+Enter to submit, Escape to cancel
 */

interface CommentComposerProps {
  prNumber: number;
  filePath: string;
  line: number;
  onClose: () => void;
}

export function CommentComposer({ prNumber, filePath, line, onClose }: CommentComposerProps) {
  const { cwd } = useWorkspace();
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const createMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      body: string;
      path: string;
      line: number;
    }) => ipc("pr.createComment", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      toastManager.add({ title: "Comment added", type: "success" });
      onClose();
    },
  });

  function handleSubmit() {
    if (!body.trim()) {
      return;
    }
    createMutation.mutate({ cwd, prNumber, body: body.trim(), path: filePath, line });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="border-border bg-bg-raised my-1 mr-3 ml-[68px] rounded-md border p-3">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment..."
        rows={3}
        className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-full resize-none rounded-md border px-3 py-2 text-xs focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-text-ghost text-[10px]">Cmd+Enter to submit · Escape to cancel</span>
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
            className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1"
            onClick={handleSubmit}
            disabled={!body.trim() || createMutation.isPending}
          >
            {createMutation.isPending && <Spinner className="h-3 w-3" />}
            Add comment
          </Button>
        </div>
      </div>
      {createMutation.isError && (
        <p className="text-destructive mt-1 text-[11px]">
          {String(
            (createMutation.error as unknown as Error)?.message ?? "Failed to create comment",
          )}
        </p>
      )}
    </div>
  );
}
