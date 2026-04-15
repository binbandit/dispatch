/* eslint-disable import/max-dependencies -- This view composes multiple UI primitives and data hooks. */
import type { MergeQueueEntry } from "@/shared/ipc";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { ipc } from "@/renderer/lib/app/ipc";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, ListOrdered, RefreshCw, ShieldOff } from "lucide-react";
import { useCallback } from "react";

export function MergeQueueView() {
  const { nwo, repoTarget } = useWorkspace();
  const { navigate } = useRouter();

  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
    staleTime: 300_000,
  });

  const hasMergeQueue = repoInfoQuery.data?.hasMergeQueue ?? false;
  const repoInfoLoading = repoInfoQuery.isLoading;

  const queueQuery = useQuery({
    queryKey: ["mergeQueue", "list", nwo],
    queryFn: () => ipc("mergeQueue.list", { ...repoTarget }),
    staleTime: 15_000,
    refetchInterval: 15_000,
    enabled: hasMergeQueue,
  });

  const entries = queueQuery.data ?? [];

  const navigateToPr = useCallback(
    (prNumber: number) => {
      navigate({ view: "review", prNumber });
    },
    [navigate],
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-text-primary text-2xl italic">Merge Queue</h1>
            <p className="text-text-secondary mt-1 text-sm">
              {hasMergeQueue
                ? `${entries.length} ${entries.length === 1 ? "PR" : "PRs"} queued to merge`
                : "Pull requests waiting to merge on this repo."}
            </p>
          </div>
          {hasMergeQueue && (
            <button
              type="button"
              onClick={() => queueQuery.refetch()}
              disabled={queueQuery.isFetching}
              className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-sm transition-colors disabled:opacity-50"
              aria-label="Refresh merge queue"
            >
              <RefreshCw
                size={14}
                className={queueQuery.isFetching ? "animate-spin" : undefined}
              />
            </button>
          )}
        </div>

        {/* Loading state */}
        {(repoInfoLoading || (hasMergeQueue && queueQuery.isLoading)) && (
          <div className="flex items-center justify-center py-16">
            <Spinner className="text-primary h-5 w-5" />
          </div>
        )}

        {/* Merge queue not enabled */}
        {!repoInfoLoading && !hasMergeQueue && (
          <div
            className="flex flex-col items-center gap-3 py-16"
            role="status"
          >
            <ShieldOff
              size={28}
              className="text-text-ghost"
            />
            <div className="text-center">
              <p className="text-text-tertiary text-sm">Merge queues are not enabled</p>
              <p className="text-text-ghost mt-1 text-xs">
                Enable merge queues in your repository&apos;s branch protection rules on GitHub.
              </p>
            </div>
          </div>
        )}

        {/* Empty queue */}
        {hasMergeQueue && !queueQuery.isLoading && entries.length === 0 && (
          <div
            className="flex flex-col items-center gap-2 py-16"
            role="status"
          >
            <ListOrdered
              size={24}
              className="text-text-ghost"
            />
            <p className="text-text-tertiary text-sm">Queue is empty</p>
            <p className="text-text-ghost text-xs">
              PRs will appear here when added to the merge queue.
            </p>
          </div>
        )}

        {/* Queue entries */}
        {hasMergeQueue && entries.length > 0 && (
          <ol className="mt-6 flex flex-col gap-2">
            {entries.map((entry) => (
              <QueueEntry
                key={entry.pullRequest.number}
                entry={entry}
                onNavigate={navigateToPr}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue entry row
// ---------------------------------------------------------------------------

const STATE_CONFIG: Record<MergeQueueEntry["state"], { label: string; className: string }> = {
  QUEUED: {
    label: "Queued",
    className: "border-warning/30 text-warning",
  },
  AWAITING_CHECKS: {
    label: "Checks",
    className: "border-info/30 text-info",
  },
  MERGEABLE: {
    label: "Mergeable",
    className: "border-success/30 text-success",
  },
  UNMERGEABLE: {
    label: "Unmergeable",
    className: "border-danger/30 text-danger",
  },
  LOCKED: {
    label: "Locked",
    className: "border-text-ghost/30 text-text-tertiary",
  },
};

function QueueEntry({
  entry,
  onNavigate,
}: {
  entry: MergeQueueEntry;
  onNavigate: (prNumber: number) => void;
}) {
  const { pullRequest, position, state, enqueuedAt, estimatedTimeToMerge } = entry;
  const stateStyle = STATE_CONFIG[state] ?? STATE_CONFIG.QUEUED;

  return (
    <li className="border-border bg-bg-raised hover:bg-bg-elevated list-none rounded-lg border transition-colors">
      <button
        type="button"
        onClick={() => onNavigate(pullRequest.number)}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
        aria-label={`PR #${pullRequest.number}: ${pullRequest.title}, position ${position + 1} in queue`}
      >
        {/* Position */}
        <span className="text-text-ghost bg-bg-surface border-border flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-medium tabular-nums">
          {position + 1}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-text-primary truncate text-sm font-semibold">
              {pullRequest.title}
            </span>
            <span className="text-text-tertiary shrink-0 font-mono text-[11px]">
              #{pullRequest.number}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Author */}
            <span className="text-text-tertiary flex items-center gap-1.5 text-xs">
              <GitHubAvatar
                login={pullRequest.author.login}
                avatarUrl={pullRequest.author.avatarUrl}
                size={14}
              />
              <span>{pullRequest.author.login}</span>
            </span>

            {/* Branch */}
            <span className="text-text-tertiary flex items-center gap-1 text-xs">
              <GitBranch size={11} />
              <span
                className="max-w-[180px] truncate font-mono text-[11px]"
                title={pullRequest.headRefName}
              >
                {pullRequest.headRefName}
              </span>
            </span>

            {/* Enqueued time */}
            <time
              dateTime={enqueuedAt}
              className="text-text-ghost font-mono text-[10px]"
              title={new Date(enqueuedAt).toLocaleString()}
            >
              queued {relativeTime(new Date(enqueuedAt))}
            </time>

            {/* ETA */}
            {estimatedTimeToMerge !== null && (
              <span className="text-text-ghost font-mono text-[10px]">
                ~{formatEta(estimatedTimeToMerge)}
              </span>
            )}
          </div>
        </div>

        {/* State badge */}
        <Badge
          variant="outline"
          className={`shrink-0 ${stateStyle.className} text-[10px]`}
          aria-label={`Queue state: ${stateStyle.label}`}
        >
          {stateStyle.label}
        </Badge>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEta(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}
