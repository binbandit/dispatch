import type { GhPrListItemCore } from "@/shared/ipc";

export type DashboardPr = GhPrListItemCore & {
  workspace: string;
  workspacePath: string;
  repository: string;
  pullRequestRepository: string;
  isForkWorkspace: boolean;
};

export interface EnrichedDashboardPr {
  pr: DashboardPr;
  hasNewActivity: boolean;
}

export type SectionId = "attention" | "ship" | "progress" | "completed";

export interface PrSection {
  id: SectionId;
  title: string;
  items: EnrichedDashboardPr[];
  defaultCollapsed?: boolean;
}

export function getDashboardPrKey(workspacePath: string, prNumber: number): string {
  return `${workspacePath}::${prNumber}`;
}

export function categorizeHomePrs(
  prs: EnrichedDashboardPr[],
  reviewRequestedKeys: Set<string>,
  currentUser: string | null,
): PrSection[] {
  const attention: EnrichedDashboardPr[] = [];
  const ship: EnrichedDashboardPr[] = [];
  const progress: EnrichedDashboardPr[] = [];
  const completed: EnrichedDashboardPr[] = [];

  for (const item of prs) {
    const key = getDashboardPrKey(item.pr.pullRequestRepository, item.pr.number);

    if (item.pr.state === "MERGED" || item.pr.state === "CLOSED") {
      completed.push(item);
    } else if (reviewRequestedKeys.has(key)) {
      attention.push(item);
    } else if (
      currentUser !== null &&
      item.pr.author.login === currentUser &&
      item.pr.reviewDecision === "CHANGES_REQUESTED"
    ) {
      attention.push(item);
    } else if (!item.pr.isDraft && item.pr.reviewDecision === "APPROVED") {
      ship.push(item);
    } else {
      progress.push(item);
    }
  }

  return [
    { id: "attention", title: "Needs your attention", items: attention },
    { id: "ship", title: "Ready to ship", items: ship },
    { id: "progress", title: "In progress", items: progress },
    {
      id: "completed",
      title: "Recently completed",
      items: completed,
      defaultCollapsed: true,
    },
  ];
}

export function preferWorkspacePrs(
  items: EnrichedDashboardPr[],
  preferredWorkspacePath: string,
): EnrichedDashboardPr[] {
  const deduped = new Map<string, EnrichedDashboardPr>();

  for (const item of items) {
    const key = getDashboardPrKey(item.pr.pullRequestRepository, item.pr.number);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, item);
    } else if (
      item.pr.workspacePath === preferredWorkspacePath &&
      existing.pr.workspacePath !== preferredWorkspacePath
    ) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()];
}
