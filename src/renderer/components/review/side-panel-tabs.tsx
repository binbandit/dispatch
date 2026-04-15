/* eslint-disable import/max-dependencies -- This module intentionally owns the side-panel's tab implementations after extraction from the overlay shell. */
import { Spinner } from "@/components/ui/spinner";
import { AiFailureExplainer } from "@/renderer/components/review/ai/ai-failure-explainer";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { ipc } from "@/renderer/lib/app/ipc";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useFileNavStore } from "@/renderer/lib/review/file-nav-context";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { Check, GitCommitHorizontal, Loader2, XCircle } from "lucide-react";
import { useCallback, useMemo } from "react";

function dedupeReviews(
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>,
) {
  const latestByUser = new Map<
    string,
    { author: { login: string }; state: string; submittedAt: string }
  >();
  for (const review of reviews) {
    const existing = latestByUser.get(review.author.login);
    if (!existing || new Date(review.submittedAt) > new Date(existing.submittedAt)) {
      latestByUser.set(review.author.login, review);
    }
  }
  return [...latestByUser.values()];
}

export function getDedupedReviews(
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>,
) {
  return dedupeReviews(reviews);
}

export function PanelCommitsContent({ prNumber }: { prNumber: number }) {
  const { repoTarget, nwo } = useWorkspace();
  const selectedCommit = useFileNavStore((s) => s.selectedCommit);
  const setSelectedCommit = useFileNavStore((s) => s.setSelectedCommit);

  const commitsQuery = useQuery({
    queryKey: ["pr", "commits", nwo, prNumber],
    queryFn: () => ipc("pr.commits", { ...repoTarget, prNumber }),
    staleTime: 60_000,
  });

  const commits = commitsQuery.data ?? [];

  const handleCommitClick = useCallback(
    (commit: { oid: string; message: string }) => {
      if (selectedCommit?.oid === commit.oid) {
        setSelectedCommit(null);
      } else {
        setSelectedCommit({ oid: commit.oid, message: commit.message });
      }
    },
    [selectedCommit, setSelectedCommit],
  );

  if (commitsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="text-primary h-4 w-4" />
      </div>
    );
  }

  if (commits.length === 0) {
    return <p className="text-text-tertiary text-xs">No commits.</p>;
  }

  const isActive = (oid: string) => selectedCommit?.oid === oid;
  const uniqueAuthors = new Set(commits.map((commit) => commit.author));
  const hasMultipleAuthors = uniqueAuthors.size > 1;

  return (
    <div>
      {selectedCommit && (
        <button
          type="button"
          onClick={() => setSelectedCommit(null)}
          className="text-accent-text hover:text-accent mb-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-[10px] font-medium transition-colors"
        >
          <GitCommitHorizontal size={11} />
          View all changes
        </button>
      )}
      {commits.map((commit, index) => {
        const isMerge = /^Merge (branch|pull request|remote-tracking|upstream)[\s/]/.test(
          commit.message,
        );
        return (
          <button
            type="button"
            key={commit.oid}
            onClick={() => handleCommitClick(commit)}
            className={`flex w-full cursor-pointer items-start gap-2 rounded-md text-left transition-colors ${
              isActive(commit.oid)
                ? "bg-accent-muted"
                : isMerge
                  ? "hover:bg-bg-raised opacity-45 hover:opacity-100"
                  : "hover:bg-bg-raised"
            }`}
            style={{
              padding: "8px 6px",
              borderBottom: index < commits.length - 1 ? "1px solid var(--border-subtle)" : "none",
            }}
          >
            <span
              className={`shrink-0 rounded-sm font-mono text-[10px] ${
                isActive(commit.oid)
                  ? "bg-accent-muted text-accent-text"
                  : "text-info bg-info-muted"
              }`}
              style={{ padding: "1px 5px" }}
            >
              {commit.oid.slice(0, 7)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-text-primary text-xs">{commit.message.split("\n")[0]}</div>
              <div className="text-text-tertiary mt-0.5 flex items-center gap-1 text-[10px]">
                {hasMultipleAuthors && (
                  <GitHubAvatar
                    login={commit.author}
                    size={13}
                    className="shrink-0 rounded-full"
                  />
                )}
                {commit.author} · {relativeTime(new Date(commit.committedDate))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function parseRunIdFromUrl(detailsUrl: string): number | null {
  const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ? Number(match[1]) : null;
}

export function PanelChecksContent({ prNumber }: { prNumber: number }) {
  const { repoTarget, nwo } = useWorkspace();
  const { navigate } = useRouter();

  const checksQuery = useQuery({
    queryKey: ["checks", "list", nwo, prNumber],
    queryFn: () => ipc("checks.list", { ...repoTarget, prNumber }),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const checks = checksQuery.data ?? [];
  const summary = useMemo(() => summarizePrChecks(checks), [checks]);

  if (checksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="text-primary h-4 w-4" />
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="py-4 text-center">
        <span className="text-text-tertiary text-xs">No CI checks configured</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-[5px] font-medium"
        style={{
          padding: "6px 0 10px",
          fontSize: "12px",
          color: summary.failed > 0 ? "var(--danger)" : "var(--success)",
        }}
      >
        {summary.failed > 0 ? <XCircle size={13} /> : <Check size={13} />}
        {summary.failed > 0
          ? `${summary.failed} failed, ${summary.passed} passed`
          : `${summary.passed} passed`}
      </div>

      {checks.map((check, index) => {
        const failed = check.conclusion === "failure";
        const pending = !check.conclusion;
        const duration =
          check.completedAt && check.startedAt
            ? formatDuration(
                new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime(),
              )
            : "—";
        const runId = parseRunIdFromUrl(check.detailsUrl);

        return (
          <div
            key={check.name}
            style={{
              borderBottom: index < checks.length - 1 ? "1px solid var(--border-subtle)" : "none",
              paddingBottom: failed && runId ? "6px" : 0,
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (runId) {
                  navigate({ view: "workflows", runId, fromPr: prNumber });
                }
              }}
              className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-1.5 rounded-sm transition-colors"
              style={{
                padding: "5px 4px",
                fontSize: "12px",
              }}
            >
              <span
                className="shrink-0"
                style={{
                  color: failed ? "var(--danger)" : pending ? "var(--warning)" : "var(--success)",
                }}
              >
                {failed ? (
                  <XCircle size={12} />
                ) : pending ? (
                  <Loader2
                    size={12}
                    className="animate-spin"
                  />
                ) : (
                  <Check size={12} />
                )}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-left"
                style={{ color: "var(--text-secondary)" }}
              >
                {check.name}
              </span>
              <span
                className="font-mono"
                style={{ fontSize: "10px", color: "var(--text-tertiary)" }}
              >
                {duration}
              </span>
            </button>
            {failed && runId && (
              <div style={{ padding: "0 4px 0 22px" }}>
                <AiFailureExplainer
                  checkName={check.name}
                  repoTarget={repoTarget}
                  runId={runId}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
