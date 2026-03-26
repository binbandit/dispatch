import type { GhPrDetail } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Eye,
  GitMerge,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { resolveMergeStrategy } from "../lib/merge-strategy";
import { summarizePrChecks } from "../lib/pr-check-status";
import { queryClient } from "../lib/query-client";

/**
 * Floating review bar — mockup-pr-review-v14.html § .review-bar
 *
 * Frosted glass bar at bottom-center. Stats → pending pill → sep → action buttons.
 */

interface FloatingReviewBarProps {
  viewedCount: number;
  totalFiles: number;
  commentCount: number;
  checkSummary: Array<{ name: string; status: string; conclusion: string | null }>;
  isAuthor: boolean;
  isDraft: boolean;
  pr: GhPrDetail;
  cwd: string;
  prNumber: number;
  canAdmin: boolean;
  hasMergeQueue: boolean;
  currentUserReview: string | null;
  isReRequested: boolean;
  panelOpen?: boolean;
}

export function FloatingReviewBar({
  viewedCount,
  totalFiles,
  commentCount,
  checkSummary,
  isAuthor,
  isDraft,
  pr,
  cwd,
  prNumber,
  canAdmin,
  hasMergeQueue,
  currentUserReview,
  isReRequested,
  panelOpen = false,
}: FloatingReviewBarProps) {
  const checks = summarizePrChecks(checkSummary);
  const allPassing = checks.state === "passing";

  return (
    <div
      style={{
        position: "absolute",
        bottom: "12px",
        left: panelOpen ? "calc((100% - min(380px, 45%)) / 2)" : "50%",
        transform: "translateX(-50%)",
        zIndex: 3,
        background: "var(--bar-glass)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-xl)",
        padding: "5px 5px 5px 12px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        boxShadow: "var(--shadow-lg), var(--shadow-glow)",
        transition: "left 0.3s ease",
      }}
    >
      {/* Stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11px",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
        }}
      >
        {/* Viewed */}
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <span style={{ color: "var(--text-tertiary)" }}>
            <Eye size={11} />
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-primary)",
            }}
          >
            {viewedCount}/{totalFiles}
          </span>
        </div>

        {/* Comments */}
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <span style={{ color: "var(--text-tertiary)" }}>
            <MessageSquare size={11} />
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-primary)",
            }}
          >
            {commentCount}
          </span>
        </div>

        {/* Checks */}
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <span style={{ color: "var(--text-tertiary)" }}>
            <Check size={11} />
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: allPassing
                ? "var(--success)"
                : checks.failed > 0
                  ? "var(--danger)"
                  : checks.pending > 0
                    ? "var(--warning)"
                    : "var(--text-primary)",
            }}
          >
            {checks.failed > 0
              ? `${checks.failed} failed`
              : checks.total > 0
                ? `${checks.passed}/${checks.total}`
                : "—"}
          </span>
        </div>
      </div>

      {/* Auto-merge pill */}
      {pr.autoMergeRequest && (
        <span
          style={{
            fontSize: "10px",
            fontWeight: 500,
            padding: "1px 7px",
            borderRadius: "var(--radius-full)",
            background: "var(--info-muted)",
            color: "var(--info)",
            fontFamily: "var(--font-mono)",
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
          }}
        >
          <GitMerge size={9} />
          auto
        </span>
      )}

      {/* Update branch button when behind */}
      {pr.mergeStateStatus === "BEHIND" && (
        <UpdateBranchPill
          cwd={cwd}
          prNumber={prNumber}
        />
      )}

      {/* Separator */}
      <div
        style={{
          width: "1px",
          height: "18px",
          background: "var(--border)",
          flexShrink: 0,
        }}
      />

      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
        {!isAuthor && (
          <>
            <RequestChangesBarButton
              cwd={cwd}
              prNumber={prNumber}
            />
            <ApproveBarButton
              cwd={cwd}
              prNumber={prNumber}
              currentUserReview={currentUserReview}
              isReRequested={isReRequested}
            />
          </>
        )}
        <MergeBarButton
          cwd={cwd}
          prNumber={prNumber}
          pr={pr}
          canAdmin={canAdmin}
          hasMergeQueue={hasMergeQueue}
          isDraft={isDraft}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons — matching mockup .btn .btn-outline / .btn-success / .btn-primary
// ---------------------------------------------------------------------------

const btnBase: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: "var(--radius-md)",
  fontSize: "11px",
  fontWeight: 500,
  fontFamily: "var(--font-sans)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  border: "1px solid transparent",
  whiteSpace: "nowrap",
  userSelect: "none",
};

function RequestChangesBarButton({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");

  const reviewMutation = useMutation({
    mutationFn: (reviewBody: string) =>
      ipc("pr.submitReview", {
        cwd,
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
      toastManager.add({ title: "Review failed", description: String(err.message), type: "error" });
    },
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          ...btnBase,
          background: "transparent",
          color: "var(--text-secondary)",
          borderColor: "var(--border-strong)",
        }}
      >
        Request Changes
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>r</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: "6px",
            width: "280px",
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
              fontSize: "11px",
              fontWeight: 500,
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            What needs to change?
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe what needs to change…"
            rows={3}
            autoFocus
            style={{
              width: "100%",
              resize: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-root)",
              color: "var(--text-primary)",
              fontSize: "11px",
              padding: "6px 8px",
              lineHeight: 1.5,
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setBody("");
              }
            }}
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
              disabled={!body.trim() || reviewMutation.isPending}
              onClick={() => reviewMutation.mutate(body.trim())}
              style={{
                ...btnBase,
                background: !body.trim() ? "var(--bg-raised)" : "var(--danger)",
                color: !body.trim() ? "var(--text-tertiary)" : "#fff",
                borderColor: !body.trim() ? "var(--border)" : "var(--danger)",
                cursor: !body.trim() ? "not-allowed" : "pointer",
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

function ApproveBarButton({
  cwd,
  prNumber,
  currentUserReview,
  isReRequested,
}: {
  cwd: string;
  prNumber: number;
  currentUserReview: string | null;
  isReRequested: boolean;
}) {
  const alreadyApproved = currentUserReview === "APPROVED" && !isReRequested;

  const reviewMutation = useMutation({
    mutationFn: () => ipc("pr.submitReview", { cwd, prNumber, event: "APPROVE" as const }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "PR approved", type: "success" });
    },
    onError: (err) => {
      toastManager.add({ title: "Review failed", description: String(err.message), type: "error" });
    },
  });

  if (alreadyApproved) {
    return (
      <button
        type="button"
        disabled
        style={{
          ...btnBase,
          background: "var(--success)",
          color: "var(--bg-root)",
          borderColor: "var(--success)",
          opacity: 0.6,
        }}
      >
        <Check size={11} />
        Approved
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => reviewMutation.mutate()}
      disabled={reviewMutation.isPending}
      style={{
        ...btnBase,
        background: "var(--success)",
        color: "var(--bg-root)",
        borderColor: "var(--success)",
        opacity: reviewMutation.isPending ? 0.5 : 1,
      }}
    >
      {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "Approve"}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>a</span>
    </button>
  );
}

function MergeBarButton({
  cwd,
  prNumber,
  pr,
  canAdmin,
  hasMergeQueue,
  isDraft,
}: {
  cwd: string;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
  canAdmin: boolean;
  hasMergeQueue: boolean;
  isDraft: boolean;
}) {
  const hasApproval = pr.reviewDecision === "APPROVED";
  const checkSummary = summarizePrChecks(pr.statusCheckRollup);
  const allChecksPassing =
    checkSummary.failed === 0 && checkSummary.pending === 0 && checkSummary.total > 0;
  const requirementsMet = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";
  const canMerge = requirementsMet || canAdmin;

  const [menuOpen, setMenuOpen] = useState(false);
  const [strategy, setStrategy] = useState<"squash" | "merge" | "rebase">("squash");
  const menuRef = useRef<HTMLDivElement>(null);

  const mergeMutation = useMutation({
    mutationFn: (args: { admin?: boolean } | void) => {
      const resolved = resolveMergeStrategy({
        hasMergeQueue,
        requirementsMet,
        canAdmin,
        explicitAdmin: args?.admin,
        strategy,
      });

      return ipc("pr.merge", {
        cwd,
        prNumber,
        strategy: resolved.strategy,
        admin: resolved.admin,
        auto: resolved.auto,
        hasMergeQueue,
      });
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      
      // Check if auto-merge was used
      const resolved = resolveMergeStrategy({
        hasMergeQueue,
        requirementsMet,
        canAdmin,
        explicitAdmin: variables?.admin,
        strategy,
      });
      
      if (resolved.auto) {
        if (result.queued) {
          toastManager.add({
            title: requirementsMet 
              ? `PR #${prNumber} queued for merge`
              : `PR #${prNumber} will auto-merge when ready`,
            description: requirementsMet ? undefined : "Waiting for checks and approvals",
            type: "success",
          });
        } else {
          toastManager.add({
            title: `PR #${prNumber} merged`,
            description: "Branch deleted.",
            type: "success",
          });
        }
      } else {
        // Admin or standard merge
        toastManager.add({
          title: `PR #${prNumber} merged`,
          description: "Branch deleted.",
          type: "success",
        });
      }
    },
    onError: (err) => {
      toastManager.add({ title: "Merge failed", description: String(err.message), type: "error" });
    },
  });

  const labels: Record<string, string> = {
    squash: "Squash & Merge",
    merge: "Merge",
    rebase: "Rebase & Merge",
  };

  const disabled = isDraft || !canMerge;
  const mainBg = disabled ? "var(--bg-raised)" : "var(--success)";
  const mainColor = disabled ? "var(--text-tertiary)" : "var(--bg-root)";
  const mainBorder = disabled ? "var(--border)" : "var(--success)";
  const mainCursor = disabled ? "not-allowed" : "pointer";

  // Merge queue mode: "Merge when ready" with admin-only dropdown
  if (hasMergeQueue) {
    return (
      <div
        ref={menuRef}
        style={{ position: "relative", display: "flex" }}
      >
        <button
          type="button"
          onClick={() => mergeMutation.mutate()}
          disabled={isDraft || !canMerge || mergeMutation.isPending}
          style={{
            ...btnBase,
            background: mainBg,
            color: mainColor,
            borderColor: mainBorder,
            cursor: mainCursor,
            borderTopRightRadius: canAdmin ? 0 : undefined,
            borderBottomRightRadius: canAdmin ? 0 : undefined,
          }}
        >
          {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={11} />}
          Merge when ready
        </button>
        {canAdmin && (
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              ...btnBase,
              background: mainBg,
              color: mainColor,
              borderColor: mainBorder,
              borderLeft: disabled ? "1px solid var(--border)" : "1px solid rgba(0,0,0,0.2)",
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              padding: "5px 4px",
            }}
          >
            <ChevronDown size={10} />
          </button>
        )}
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: "4px",
              width: "180px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "4px",
              boxShadow: "var(--shadow-lg)",
              zIndex: 50,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                mergeMutation.mutate({ admin: true });
              }}
              disabled={mergeMutation.isPending}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "11px",
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "var(--warning)",
              }}
            >
              <ShieldAlert size={11} />
              Merge now (admin)
            </button>
          </div>
        )}
      </div>
    );
  }

  // Standard mode: split button with strategy selection
  return (
    <div
      ref={menuRef}
      style={{ position: "relative", display: "flex" }}
    >
      <button
        type="button"
        onClick={() => mergeMutation.mutate()}
        disabled={isDraft || !canMerge || mergeMutation.isPending}
        style={{
          ...btnBase,
          background: mainBg,
          color: mainColor,
          borderColor: mainBorder,
          cursor: mainCursor,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        }}
      >
        {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={11} />}
        {labels[strategy]}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          ...btnBase,
          background: mainBg,
          color: mainColor,
          borderColor: mainBorder,
          borderLeft: disabled ? "1px solid var(--border)" : "1px solid rgba(0,0,0,0.2)",
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          padding: "5px 4px",
        }}
      >
        <ChevronDown size={10} />
      </button>
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: "4px",
            width: "180px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "4px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 50,
          }}
        >
          {(["squash", "merge", "rebase"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStrategy(s);
                setMenuOpen(false);
              }}
              style={{
                display: "flex",
                width: "100%",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "11px",
                cursor: "pointer",
                border: "none",
                background: strategy === s ? "var(--accent-muted)" : "transparent",
                color: strategy === s ? "var(--accent-text)" : "var(--text-secondary)",
                textAlign: "left",
              }}
            >
              {labels[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdateBranchPill({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const updateMutation = useMutation({
    mutationFn: () => ipc("pr.updateBranch", { cwd, prNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "Branch updated", type: "success" });
    },
    onError: (err) => {
      toastManager.add({
        title: "Update failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  return (
    <button
      type="button"
      onClick={() => updateMutation.mutate()}
      disabled={updateMutation.isPending}
      style={{
        ...btnBase,
        background: "transparent",
        color: "var(--warning)",
        borderColor: "var(--border)",
        fontSize: "10px",
        padding: "2px 7px",
        gap: "3px",
        opacity: updateMutation.isPending ? 0.5 : 1,
      }}
    >
      {updateMutation.isPending ? <Spinner className="h-2.5 w-2.5" /> : <RefreshCw size={9} />}
      Update branch
    </button>
  );
}
