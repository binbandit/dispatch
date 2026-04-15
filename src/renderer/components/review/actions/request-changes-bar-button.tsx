/* eslint-disable import/max-dependencies -- Review action button with many focused dependencies. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { useMutation } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useState } from "react";

import { btnBase } from "./floating-review-bar";

export function RequestChangesBarButton({
  repoTarget,
  prNumber,
  compact,
  dense,
}: {
  repoTarget: RepoTarget;
  prNumber: number;
  compact: boolean;
  dense: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const hasReviewBody = body.trim().length > 0;
  const { getBinding } = useKeybindings();

  const reviewMutation = useMutation({
    mutationFn: (reviewBody: string) =>
      ipc("pr.submitReview", {
        ...repoTarget,
        prNumber,
        event: "REQUEST_CHANGES" as const,
        body: reviewBody,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "Changes requested", type: "success" });
      setBody("");
      setOpen(false);
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: getErrorMessage(err),
        type: "error",
      });
    },
  });

  useKeyboardShortcuts([
    {
      ...getBinding("actions.requestChanges"),
      handler: () => setOpen((prev) => !prev),
      when: () => !open,
    },
  ]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={dense ? "Request changes" : undefined}
        aria-label="Request changes"
        style={{
          ...btnBase,
          background: "transparent",
          color: "var(--text-secondary)",
          borderColor: "var(--border-strong)",
          padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
        }}
      >
        <MessageSquare size={11} />
        {!dense && (compact ? "Request" : "Request Changes")}
        {!compact && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>r</span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: "6px",
            width: "340px",
            maxWidth: "calc(100vw - 32px)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "10px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              fontSize: "10px",
              fontWeight: 500,
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            What needs to change?
          </div>
          <ReviewMarkdownComposer
            autoFocus
            compact
            onChange={setBody}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setBody("");
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hasReviewBody) {
                e.preventDefault();
                reviewMutation.mutate(body.trim());
              }
            }}
            placeholder="Describe what needs to change…"
            prNumber={prNumber}
            rows={4}
            value={body}
          />
          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: "4px", marginTop: "6px" }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setBody("");
              }}
              style={{
                ...btnBase,
                background: "transparent",
                color: "var(--text-secondary)",
                borderColor: "var(--border)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!hasReviewBody || reviewMutation.isPending}
              onClick={() => reviewMutation.mutate(body.trim())}
              style={{
                ...btnBase,
                background: hasReviewBody ? "var(--danger)" : "var(--bg-raised)",
                color: hasReviewBody ? "var(--primary-foreground)" : "var(--text-tertiary)",
                borderColor: hasReviewBody ? "var(--danger)" : "var(--border)",
                cursor: hasReviewBody ? "pointer" : "not-allowed",
                opacity: reviewMutation.isPending ? 0.5 : 1,
              }}
            >
              {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "Submit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
