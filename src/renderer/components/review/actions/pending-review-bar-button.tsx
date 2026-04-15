/* eslint-disable import/max-dependencies -- Review submit button composes mutation, store, and composer. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import {
  usePendingComments,
  usePendingReviewActions,
} from "@/renderer/lib/review/pending-review-store";
import { useMutation } from "@tanstack/react-query";
import { FileText, Send, Trash2, X } from "lucide-react";
import { useState } from "react";

import { btnBase } from "./floating-review-bar";

type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export function PendingReviewBarButton({
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
  const pendingComments = usePendingComments(prNumber);
  const { clearComments, removeComment } = usePendingReviewActions();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [showComments, setShowComments] = useState(false);

  const submitMutation = useMutation({
    mutationFn: (event: ReviewEvent) =>
      ipc("pr.submitReviewWithComments", {
        ...repoTarget,
        prNumber,
        event,
        body: body.trim() || undefined,
        comments: pendingComments.map((c) => ({
          path: c.filePath,
          line: c.line,
          side: c.side,
          startLine: c.startLine,
          startSide: c.startSide,
          body: c.body,
        })),
      }),
    onSuccess: (_, event) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      const labels: Record<ReviewEvent, string> = {
        COMMENT: "Review submitted",
        REQUEST_CHANGES: "Changes requested",
        APPROVE: "PR approved",
      };
      toastManager.add({ title: labels[event], type: "success" });
      clearComments(prNumber);
      setBody("");
      setOpen(false);
      setShowComments(false);
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: getErrorMessage(err),
        type: "error",
      });
    },
  });

  if (pendingComments.length === 0) {
    return null;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={dense ? "Submit review" : undefined}
        aria-label="Submit pending review"
        style={{
          ...btnBase,
          background: "var(--accent-muted)",
          color: "var(--accent-text)",
          borderColor: "var(--border-accent)",
          padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
        }}
      >
        <FileText size={11} />
        {!dense && (compact ? "Review" : "Submit Review")}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            background: "var(--accent)",
            color: "var(--primary-foreground)",
            borderRadius: "var(--radius-full)",
            padding: "0 4px",
            minWidth: "14px",
            textAlign: "center",
            lineHeight: "14px",
          }}
        >
          {pendingComments.length}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: "6px",
            width: "380px",
            maxWidth: "calc(100vw - 32px)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: "10px", fontWeight: 500, color: "var(--text-primary)" }}>
              Pending review ({pendingComments.length} comment
              {pendingComments.length === 1 ? "" : "s"})
            </span>
            <div style={{ display: "flex", gap: "2px" }}>
              <button
                type="button"
                onClick={() => setShowComments(!showComments)}
                title="Toggle comment list"
                style={{
                  ...btnBase,
                  padding: "2px 6px",
                  background: showComments ? "var(--bg-surface)" : "transparent",
                  color: "var(--text-tertiary)",
                  borderColor: showComments ? "var(--border)" : "transparent",
                  fontSize: "10px",
                }}
              >
                <FileText size={10} />
                {showComments ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearComments(prNumber);
                  setOpen(false);
                  setShowComments(false);
                  toastManager.add({ title: "Pending comments discarded", type: "success" });
                }}
                title="Discard all pending comments"
                style={{
                  ...btnBase,
                  padding: "2px 6px",
                  background: "transparent",
                  color: "var(--danger)",
                  borderColor: "transparent",
                  fontSize: "10px",
                }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          </div>

          {/* Pending comments list */}
          {showComments && (
            <div
              style={{
                maxHeight: "160px",
                overflowY: "auto",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              {pendingComments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "6px",
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: "10px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-tertiary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.filePath}:{c.line}
                    </div>
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        marginTop: "2px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.body.slice(0, 80)}
                      {c.body.length > 80 ? "…" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComment(prNumber, c.id)}
                    title="Remove comment"
                    style={{
                      ...btnBase,
                      padding: "2px",
                      background: "transparent",
                      color: "var(--text-ghost)",
                      borderColor: "transparent",
                      flexShrink: 0,
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Review body */}
          <div style={{ padding: "10px" }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 500,
                color: "var(--text-primary)",
                marginBottom: "6px",
              }}
            >
              Review summary (optional)
            </div>
            <ReviewMarkdownComposer
              autoFocus
              compact
              onChange={setBody}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Write a summary for your review…"
              prNumber={prNumber}
              rows={3}
              value={body}
            />
          </div>

          {/* Submit actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "4px",
              padding: "0 10px 10px",
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
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
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate("COMMENT")}
              style={{
                ...btnBase,
                background: "var(--bg-raised)",
                color: "var(--text-primary)",
                borderColor: "var(--border-strong)",
                opacity: submitMutation.isPending ? 0.5 : 1,
              }}
            >
              {submitMutation.isPending ? <Spinner className="h-3 w-3" /> : <Send size={10} />}
              Comment
            </button>
            <button
              type="button"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate("REQUEST_CHANGES")}
              style={{
                ...btnBase,
                background: "var(--danger)",
                color: "var(--primary-foreground)",
                borderColor: "var(--danger)",
                opacity: submitMutation.isPending ? 0.5 : 1,
              }}
            >
              Request Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
