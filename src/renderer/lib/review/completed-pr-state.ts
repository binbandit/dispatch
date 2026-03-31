import type { GhPrDetail, GhPrListItemCore } from "@/shared/ipc";

type PullRequestState = GhPrListItemCore["state"];

export function isCompletedPullRequest(
  pr: Pick<GhPrDetail, "state"> | Pick<GhPrListItemCore, "state">,
): boolean {
  return pr.state === "CLOSED" || pr.state === "MERGED";
}

export function getCompletedPullRequestLabel(state: PullRequestState): "Closed" | "Merged" | null {
  if (state === "MERGED") {
    return "Merged";
  }

  if (state === "CLOSED") {
    return "Closed";
  }

  return null;
}

export function getCompletedPullRequestTimestamp(
  pr: Pick<GhPrDetail, "state" | "closedAt" | "mergedAt">,
): string | null {
  if (pr.state === "MERGED") {
    return pr.mergedAt ?? pr.closedAt;
  }

  if (pr.state === "CLOSED") {
    return pr.closedAt;
  }

  return null;
}
