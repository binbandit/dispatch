import type { GhPrListItem } from "@/shared/ipc";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { ipc } from "../lib/ipc";
import { sendNotification } from "../lib/notifications";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Background hook that polls PR data and sends desktop notifications
 * when important events occur:
 *
 * - New PR assigned for review
 * - CI fails on your PR
 * - Your PR gets approved
 */
export function useNotificationPolling(): void {
  const { cwd } = useWorkspace();
  const previousReviewPrs = useRef<Map<number, GhPrListItem>>(new Map());
  const previousAuthorPrs = useRef<Map<number, GhPrListItem>>(new Map());
  const initialized = useRef(false);

  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
  });

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
        sendNotification(
          "Review requested",
          `#${pr.number} ${pr.title} by ${pr.author.login}`,
          "review",
        );
      }
    }

    // Check authored PRs for CI failures and approvals
    for (const pr of authorQuery.data) {
      const prev = previousAuthorPrs.current.get(pr.number);
      if (!prev) {
        continue;
      }

      // CI failure
      const prevFailing = prev.statusCheckRollup.some((c) => c.conclusion === "failure");
      const nowFailing = pr.statusCheckRollup.some((c) => c.conclusion === "failure");
      if (nowFailing && !prevFailing) {
        sendNotification("CI failed", `#${pr.number} ${pr.title}`, "ci-fail");
      }

      // Approved
      if (pr.reviewDecision === "APPROVED" && prev.reviewDecision !== "APPROVED") {
        sendNotification("PR approved", `#${pr.number} ${pr.title}`, "approve");
      }
    }

    // Update refs
    previousReviewPrs.current = new Map(reviewQuery.data.map((pr) => [pr.number, pr]));
    previousAuthorPrs.current = new Map(authorQuery.data.map((pr) => [pr.number, pr]));

    // Update dock badge with pending review count
    window.api.setBadgeCount(reviewQuery.data.length);
  }, [reviewQuery.data, authorQuery.data]);
}
