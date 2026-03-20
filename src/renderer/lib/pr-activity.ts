import type { PrActivityState } from "@/shared/ipc";

export function getPrActivityKey(repo: string, prNumber: number): string {
  return `${repo}::${prNumber}`;
}

export function indexPrActivityStates(
  activityStates: readonly PrActivityState[],
): Map<string, PrActivityState> {
  return new Map(
    activityStates.map((activity) => [
      getPrActivityKey(activity.repo, activity.prNumber),
      activity,
    ]),
  );
}

export function hasNewPrActivity(
  updatedAt: string,
  activityState: Pick<PrActivityState, "lastSeenUpdatedAt"> | null | undefined,
): boolean {
  if (!activityState?.lastSeenUpdatedAt) {
    return false;
  }

  const currentUpdatedAt = Date.parse(updatedAt);
  const lastSeenUpdatedAt = Date.parse(activityState.lastSeenUpdatedAt);

  if (Number.isNaN(currentUpdatedAt) || Number.isNaN(lastSeenUpdatedAt)) {
    return false;
  }

  return currentUpdatedAt > lastSeenUpdatedAt;
}
