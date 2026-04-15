/* eslint-disable import/max-dependencies -- Floating review bar intentionally composes review and merge controls. */
import type { GhPrDetail, RepoTarget } from "@/shared/ipc";

import { useMediaQuery } from "@/hooks/use-media-query";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { Check, Eye, GitMerge, MessageSquare } from "lucide-react";

import { ApproveBarButton } from "./approve-bar-button";
import { MergeBarButton } from "./merge-bar-button";
import { PendingReviewBarButton } from "./pending-review-bar-button";
import { RequestChangesBarButton } from "./request-changes-bar-button";
import { UpdateBranchPill } from "./update-branch-pill";

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
  repoTarget: RepoTarget;
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
  repoTarget,
  prNumber,
  canAdmin,
  hasMergeQueue,
  currentUserReview,
  isReRequested,
  panelOpen = false,
}: FloatingReviewBarProps) {
  const compactBar = useMediaQuery({ max: 1180 });
  const denseBar = useMediaQuery({ max: 960 });
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
        maxWidth: panelOpen ? "calc(100% - min(380px, 45%) - 24px)" : "calc(100% - 24px)",
        background: "var(--bar-glass)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-xl)",
        padding: denseBar ? "4px 4px 4px 10px" : "5px 5px 5px 12px",
        display: "flex",
        alignItems: "center",
        gap: compactBar ? "6px" : "8px",
        overflow: "visible",
        boxShadow: "var(--shadow-lg), var(--shadow-glow)",
        transition: "left 0.3s ease",
      }}
    >
      {/* Stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: compactBar ? "6px" : "8px",
          fontSize: "10px",
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
          repoTarget={repoTarget}
          prNumber={prNumber}
          compact={compactBar}
          dense={denseBar}
        />
      )}

      {/* Separator */}
      <div
        style={{
          width: "1px",
          height: denseBar ? "16px" : "18px",
          background: "var(--border)",
          flexShrink: 0,
        }}
      />

      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: compactBar ? "2px" : "3px" }}>
        <PendingReviewBarButton
          repoTarget={repoTarget}
          prNumber={prNumber}
          compact={compactBar}
          dense={denseBar}
        />
        {!isAuthor && (
          <>
            <RequestChangesBarButton
              repoTarget={repoTarget}
              prNumber={prNumber}
              compact={compactBar}
              dense={denseBar}
            />
            <ApproveBarButton
              repoTarget={repoTarget}
              prNumber={prNumber}
              currentUserReview={currentUserReview}
              isReRequested={isReRequested}
              compact={compactBar}
              dense={denseBar}
            />
          </>
        )}
        <MergeBarButton
          repoTarget={repoTarget}
          prNumber={prNumber}
          pr={pr}
          canAdmin={canAdmin}
          hasMergeQueue={hasMergeQueue}
          isDraft={isDraft}
          compact={compactBar}
          dense={denseBar}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons — matching mockup .btn .btn-outline / .btn-success / .btn-primary
// ---------------------------------------------------------------------------

export const btnBase: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: "var(--radius-md)",
  fontSize: "10px",
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
