import type { GhPrEnrichment, GhPrListItemCore } from "@/shared/ipc";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Background hook that polls PR data and sends desktop notifications
 * when important events occur:
 *
 * - New PR assigned for review
 * - CI fails on your PR
 * - Your PR gets approved
 *
 * Uses the same query keys as the PR inbox so React Query deduplicates
 * the network calls. The enrichment queries (statusCheckRollup) are
 * fetched lazily — CI failure notifications only fire once enrichment
 * data arrives.
 */
export function useNotificationPolling(): void {
  const { cwd } = useWorkspace();
  const previousReviewPrs = useRef<Map<number, GhPrListItemCore>>(new Map());
  const previousAuthorPrs = useRef<Map<number, GhPrListItemCore>>(new Map());
  const previousEnrichment = useRef<Map<number, GhPrEnrichment>>(new Map());
  const initialized = useRef(false);
  const enrichmentInitialized = useRef(false);

  // Core queries — shared with PR inbox via query keys
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

  // Enrichment query for authored PRs — needed for CI failure detection
  const authorEnrichmentQuery = useQuery({
    queryKey: ["pr", "enrichment", cwd, "authored"],
    queryFn: () => ipc("pr.listEnrichment", { cwd, filter: "authored" }),
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
      if (!prev) {
        continue;
      }

      if (pr.reviewDecision === "APPROVED" && prev.reviewDecision !== "APPROVED") {
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
    window.api.setBadgeCount(reviewQuery.data.length);
  }, [reviewQuery.data, authorQuery.data, cwd]);

  // Handle enrichment data: CI failure notifications
  useEffect(() => {
    if (!authorEnrichmentQuery.data || !authorQuery.data) {
      return;
    }

    // Skip first load
    if (!enrichmentInitialized.current) {
      enrichmentInitialized.current = true;
      for (const e of authorEnrichmentQuery.data) {
        previousEnrichment.current.set(e.number, e);
      }
      return;
    }

    // Build a lookup for authored PR titles (for notification body)
    const authorPrMap = new Map(authorQuery.data.map((pr) => [pr.number, pr]));

    for (const e of authorEnrichmentQuery.data) {
      const prev = previousEnrichment.current.get(e.number);
      if (!prev) {
        continue;
      }

      const prevFailing = prev.statusCheckRollup.some(
        (c) => c.conclusion?.toUpperCase() === "FAILURE",
      );
      const nowFailing = e.statusCheckRollup.some(
        (c) => c.conclusion?.toUpperCase() === "FAILURE",
      );
      if (nowFailing && !prevFailing) {
        const pr = authorPrMap.get(e.number);
        void ipc("notifications.show", {
          type: "ci-fail",
          title: "CI failed",
          body: `#${e.number} ${pr?.title ?? ""}`,
          prNumber: e.number,
          workspace: cwd,
          authorLogin: pr?.author.login,
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        });
      }
    }

    previousEnrichment.current = new Map(authorEnrichmentQuery.data.map((e) => [e.number, e]));
  }, [authorEnrichmentQuery.data, authorQuery.data, cwd]);
}
