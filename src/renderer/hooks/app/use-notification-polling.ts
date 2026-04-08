import type { GhPrListItemCore } from "@/shared/ipc";

import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Background hook that polls PR data and sends desktop notifications
 * when important events occur:
 *
 * - New PR assigned for review
 * - Your PR gets approved
 *
 * Uses the same query keys as the PR inbox so React Query deduplicates
 * the network calls.
 */
export function useNotificationPolling(): void {
  const { cwd } = useWorkspace();
  const previousReviewPrs = useRef<Map<number, GhPrListItemCore>>(new Map());
  const previousAuthorPrs = useRef<Map<number, GhPrListItemCore>>(new Map());
  const initialized = useRef(false);

  // Core queries — shared with PR inbox via query keys
  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested", "open"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored", "open"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
  });

  // Handle core data: new review requests + approval notifications
  useEffect(() => {
    if (!reviewQuery.data || !authorQuery.data) {
      return;
    }

    // Skip first load — don't notify for existing state
    if (!initialized.current) {
      initialized.current = true;
      for (const pr of reviewQuery.data) {
        previousReviewPrs.current.set(pr.number, pr);
      }
      for (const pr of authorQuery.data) {
        previousAuthorPrs.current.set(pr.number, pr);
      }
      return;
    }

    // Check for new review requests
    for (const pr of reviewQuery.data) {
      if (!previousReviewPrs.current.has(pr.number)) {
        void ipc("notifications.show", {
          type: "review",
          title: "Review requested",
          body: `#${pr.number} ${pr.title} by ${pr.author.login}`,
          prNumber: pr.number,
          workspace: cwd,
          authorLogin: pr.author.login,
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        });
      }
    }

    // Check authored PRs for approvals (reviewDecision is in core fields)
    for (const pr of authorQuery.data) {
      const prev = previousAuthorPrs.current.get(pr.number);
      if (prev && pr.reviewDecision === "APPROVED" && prev.reviewDecision !== "APPROVED") {
        void ipc("notifications.show", {
          type: "approve",
          title: "PR approved",
          body: `#${pr.number} ${pr.title}`,
          prNumber: pr.number,
          workspace: cwd,
          authorLogin: pr.author.login,
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        });
      }
    }

    // Update refs
    previousReviewPrs.current = new Map(reviewQuery.data.map((pr) => [pr.number, pr]));
    previousAuthorPrs.current = new Map(authorQuery.data.map((pr) => [pr.number, pr]));

    // Update dock badge with pending review count
    globalThis.api.setBadgeCount(reviewQuery.data.length);
  }, [reviewQuery.data, authorQuery.data, cwd]);
}
