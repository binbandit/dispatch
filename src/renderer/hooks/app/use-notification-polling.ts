import type { GhPrEnrichment, GhPrListItemCore } from "@/shared/ipc";

import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

type AllReviewPr = GhPrListItemCore & {
  workspace: string;
  workspacePath: string | null;
  pullRequestRepository: string;
};

type AllReviewPrEnrichment = GhPrEnrichment & {
  workspacePath: string | null;
  pullRequestRepository: string;
};

type NotificationInput = {
  type: "review" | "ci-fail" | "approve" | "merge";
  title: string;
  body: string;
  prNumber: number;
  workspace: string;
  authorLogin?: string;
};

function getPrNotificationKey(pr: { pullRequestRepository: string; number: number }): string {
  return `${pr.pullRequestRepository}::${pr.number}`;
}

function getNotificationWorkspace(
  pr: { workspacePath: string | null; workspace: string },
  fallbackWorkspace: string,
): string {
  return pr.workspacePath ?? pr.workspace ?? fallbackWorkspace;
}

function isCiFailing(pr: AllReviewPrEnrichment): boolean {
  return summarizePrChecks(pr.statusCheckRollup).state === "failing";
}

function hasUpdatedSince(previous: AllReviewPr | undefined, current: AllReviewPr): boolean {
  if (!previous) {
    return false;
  }

  return Date.parse(current.updatedAt) > Date.parse(previous.updatedAt);
}

function isReadyToShip(pr: AllReviewPr, enrichment: AllReviewPrEnrichment | undefined): boolean {
  if (pr.isDraft) {
    return false;
  }
  if (pr.reviewDecision !== "APPROVED") {
    return false;
  }
  if (!enrichment) {
    return false;
  }
  return summarizePrChecks(enrichment.statusCheckRollup).state === "passing";
}

function mapByKey<T extends { pullRequestRepository: string; number: number }>(
  items: readonly T[],
): Map<string, T> {
  return new Map(items.map((item) => [getPrNotificationKey(item), item]));
}

function showNotification(input: NotificationInput): void {
  void ipc("notifications.show", input).then(() => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });
}

/**
 * Background hook that polls PR data and sends desktop notifications
 * when important events occur:
 *
 * - New PR assigned for review
 * - Review-requested PRs receiving updates
 * - Your PR gets approved
 * - CI failures in review requests
 * - Owned PRs becoming merge-ready
 *
 * Uses the same query keys as the PR inbox so React Query deduplicates
 * the network calls.
 */
export function useNotificationPolling(): void {
  const { nwo } = useWorkspace();
  const previousReviewPrs = useRef<Map<string, AllReviewPr>>(new Map());
  const previousAuthorPrs = useRef<Map<string, AllReviewPr>>(new Map());
  const previousReviewEnrichment = useRef<Map<string, AllReviewPrEnrichment>>(new Map());
  const previousAuthorReady = useRef<Map<string, boolean>>(new Map());
  const initialized = useRef(false);

  const reviewQuery = useQuery({
    queryKey: ["pr", "listAll", "reviewRequested", "open"],
    queryFn: () => ipc("pr.listAll", { filter: "reviewRequested", state: "open" }),
    refetchInterval: 30_000,
  });

  const reviewEnrichmentQuery = useQuery({
    queryKey: ["pr", "listAllEnrichment", "reviewRequested", "open"],
    queryFn: () =>
      ipc("pr.listAllEnrichment", {
        filter: "reviewRequested",
        state: "open",
      }),
    refetchInterval: 30_000,
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "listAll", "authored", "open"],
    queryFn: () => ipc("pr.listAll", { filter: "authored", state: "open" }),
    refetchInterval: 30_000,
  });

  const authorEnrichmentQuery = useQuery({
    queryKey: ["pr", "listAllEnrichment", "authored", "open"],
    queryFn: () =>
      ipc("pr.listAllEnrichment", {
        filter: "authored",
        state: "open",
      }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (
      !reviewQuery.data ||
      !reviewEnrichmentQuery.data ||
      !authorQuery.data ||
      !authorEnrichmentQuery.data
    ) {
      return;
    }

    const reviewByKey = mapByKey<AllReviewPr>(reviewQuery.data);
    const reviewEnrichmentByKey = mapByKey<AllReviewPrEnrichment>(reviewEnrichmentQuery.data);
    const authorByKey = mapByKey<AllReviewPr>(authorQuery.data);
    const authorEnrichmentByKey = mapByKey<AllReviewPrEnrichment>(authorEnrichmentQuery.data);

    if (!initialized.current) {
      initialized.current = true;
      previousReviewPrs.current = reviewByKey;
      previousAuthorPrs.current = authorByKey;
      previousReviewEnrichment.current = reviewEnrichmentByKey;
      previousAuthorReady.current = new Map(
        [...authorByKey].map(([key, pr]) => [key, isReadyToShip(pr, authorEnrichmentByKey.get(key))]),
      );
      globalThis.api.setBadgeCount(reviewQuery.data.length);
      return;
    }

    for (const [key, pr] of reviewByKey) {
      const prevPr = previousReviewPrs.current.get(key);

      if (prevPr && hasUpdatedSince(prevPr, pr)) {
        showNotification({
          type: "review",
          title: "Review request updated",
          body: `#${pr.number} ${pr.title} by ${pr.author.login}`,
          prNumber: pr.number,
          workspace: getNotificationWorkspace(pr, nwo),
          authorLogin: pr.author.login,
        });
      }

      if (!previousReviewPrs.current.has(key)) {
        showNotification({
          type: "review",
          title: "Review requested",
          body: `#${pr.number} ${pr.title} by ${pr.author.login}`,
          prNumber: pr.number,
          workspace: getNotificationWorkspace(pr, nwo),
          authorLogin: pr.author.login,
        });
      }
    }

    for (const [key, pr] of reviewEnrichmentByKey) {
      const corePr = reviewByKey.get(key);
      if (!corePr) {
        continue;
      }

      const wasFailing = previousReviewEnrichment.current.get(key);
      const isFailing = isCiFailing(pr);
      const previouslyFailing = wasFailing ? isCiFailing(wasFailing) : false;

      if (isFailing && !previouslyFailing) {
        showNotification({
          type: "ci-fail",
          title: "CI checks failed",
          body: `#${corePr.number} ${corePr.title} by ${corePr.author.login}`,
          prNumber: corePr.number,
          workspace: getNotificationWorkspace(corePr, nwo),
          authorLogin: corePr.author.login,
        });
      }
    }

    for (const [key, pr] of authorByKey) {
      const prevPr = previousAuthorPrs.current.get(key);
      const prevReady = previousAuthorReady.current.get(key);
      const nextReady = isReadyToShip(pr, authorEnrichmentByKey.get(key));

      if (prevPr && pr.reviewDecision === "APPROVED" && prevPr.reviewDecision !== "APPROVED") {
        showNotification({
          type: "approve",
          title: "PR approved",
          body: `#${pr.number} ${pr.title}`,
          prNumber: pr.number,
          workspace: getNotificationWorkspace(pr, nwo),
          authorLogin: pr.author.login,
        });
      }

      if (nextReady && !prevReady) {
        showNotification({
          type: "merge",
          title: "PR ready to ship",
          body: `#${pr.number} ${pr.title}`,
          prNumber: pr.number,
          workspace: getNotificationWorkspace(pr, nwo),
          authorLogin: pr.author.login,
        });
      }
    }

    previousReviewPrs.current = reviewByKey;
    previousAuthorPrs.current = authorByKey;
    previousReviewEnrichment.current = reviewEnrichmentByKey;
    previousAuthorReady.current = new Map(
      [...authorByKey].map(([key, pr]) => [key, isReadyToShip(pr, authorEnrichmentByKey.get(key))]),
    );

    globalThis.api.setBadgeCount(reviewQuery.data.length);
  }, [
    reviewQuery.data,
    reviewEnrichmentQuery.data,
    authorQuery.data,
    authorEnrichmentQuery.data,
    nwo,
  ]);
}
