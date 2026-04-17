/* eslint-disable import/max-dependencies -- This module intentionally owns the side-panel's tab implementations after extraction from the overlay shell. */
import type { GhCheckRun, RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { AiFailureExplainer } from "@/renderer/components/review/ai/ai-failure-explainer";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { JobRow } from "@/renderer/components/workflows/job-row";
import { JobStepsAccordion } from "@/renderer/components/workflows/job-steps-accordion";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
import { useFileNavStore } from "@/renderer/lib/review/file-nav-context";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { Check, GitCommitHorizontal, Search, XCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
  const [searchQuery, setSearchQuery] = useState("");

  const commitsQuery = useQuery({
    queryKey: ["pr", "commits", nwo, prNumber],
    queryFn: () => ipc("pr.commits", { ...repoTarget, prNumber }),
    staleTime: 60_000,
  });

  const commits = commitsQuery.data ?? [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCommits = useMemo(
    () =>
      normalizedQuery.length === 0
        ? commits
        : commits.filter((commit) =>
            [commit.message, commit.author, commit.oid]
              .join("\n")
              .toLowerCase()
              .includes(normalizedQuery),
          ),
    [commits, normalizedQuery],
  );

  const handleCommitClick = useCallback(
    (commit: { oid: string; message: string; hasReviewableChanges: boolean }) => {
      if (!commit.hasReviewableChanges) {
        return;
      }
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
    <div
      data-review-focus-target="panel-commits"
      tabIndex={-1}
    >
      <div className="mb-2">
        <div className="border-border bg-bg-raised flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search
            size={11}
            className="text-text-tertiary shrink-0"
          />
          <input
            data-review-focus-target="panel-search"
            aria-label="Filter commits"
            autoComplete="off"
            name="panel-commits-search"
            spellCheck={false}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              handleSearchInputEscape(event);
            }}
            placeholder="Filter commits…"
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] focus:outline-none"
          />
        </div>
      </div>
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
      {filteredCommits.length === 0 && normalizedQuery.length > 0 && (
        <p className="text-text-tertiary px-1 py-3 text-xs">
          No commits match “{searchQuery.trim()}”.
        </p>
      )}
      {filteredCommits.map((commit, index) => {
        const isMerge = /^Merge (branch|pull request|remote-tracking|upstream)[\s/]/.test(
          commit.message,
        );
        const isDisabled = !commit.hasReviewableChanges;
        return (
          <button
            type="button"
            key={commit.oid}
            onClick={() => handleCommitClick(commit)}
            disabled={isDisabled}
            title={isDisabled ? "This commit has no file changes to review." : undefined}
            className={`flex w-full items-start gap-2 rounded-md text-left transition-colors disabled:cursor-default disabled:opacity-40 ${
              isActive(commit.oid)
                ? "bg-accent-muted"
                : isMerge
                  ? "hover:bg-bg-raised opacity-45 hover:opacity-100"
                  : "hover:bg-bg-raised"
            }`}
            style={{
              padding: "8px 6px",
              borderBottom:
                index < filteredCommits.length - 1 ? "1px solid var(--border-subtle)" : "none",
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
              {isDisabled && <div className="text-text-tertiary mt-1 text-[10px]">No changes</div>}
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
  const [searchQuery, setSearchQuery] = useState("");

  const checksQuery = useQuery({
    queryKey: ["checks", "list", nwo, prNumber],
    queryFn: () => ipc("checks.list", { ...repoTarget, prNumber }),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const checks = checksQuery.data ?? [];
  const summary = useMemo(() => summarizePrChecks(checks), [checks]);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredChecks = useMemo(
    () =>
      normalizedQuery.length === 0
        ? checks
        : checks.filter((check) =>
            [check.name, check.status, check.conclusion ?? ""]
              .join("\n")
              .toLowerCase()
              .includes(normalizedQuery),
          ),
    [checks, normalizedQuery],
  );

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
    <div
      data-review-focus-target="panel-checks"
      tabIndex={-1}
    >
      <div className="mb-2">
        <div className="border-border bg-bg-raised flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search
            size={11}
            className="text-text-tertiary shrink-0"
          />
          <input
            data-review-focus-target="panel-search"
            aria-label="Filter checks"
            autoComplete="off"
            name="panel-checks-search"
            spellCheck={false}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              handleSearchInputEscape(event);
            }}
            placeholder="Filter checks…"
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] focus:outline-none"
          />
        </div>
      </div>
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

      {filteredChecks.length === 0 && normalizedQuery.length > 0 && (
        <p className="text-text-tertiary py-3 text-xs">No checks match “{searchQuery.trim()}”.</p>
      )}

      <div className="border-border -mx-3.5 border-t">
        {filteredChecks.map((check) => {
          const runId = parseRunIdFromUrl(check.detailsUrl);
          return (
            <CheckJobRow
              key={check.name}
              check={check}
              runId={runId}
              repoTarget={repoTarget}
            />
          );
        })}
      </div>
    </div>
  );
}

function CheckJobRow({
  check,
  runId,
  repoTarget,
}: {
  check: GhCheckRun;
  runId: number | null;
  repoTarget: RepoTarget;
}) {
  const detailQuery = useQuery({
    queryKey: ["workflows", "runDetail", repoTarget.owner, repoTarget.repo, runId],
    queryFn: () => ipc("workflows.runDetail", { ...repoTarget, runId: runId ?? 0 }),
    enabled: runId !== null,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const matchingJob = detailQuery.data?.jobs.find((j) => j.name === check.name);
  const failed = check.conclusion === "failure" || check.conclusion === "error";
  const hasSteps = (matchingJob?.steps.length ?? 0) > 0;
  const expandable = detailQuery.isLoading ? true : hasSteps;

  return (
    <JobRow
      name={check.name}
      status={matchingJob?.status ?? check.status}
      conclusion={matchingJob?.conclusion ?? check.conclusion}
      startedAt={matchingJob?.startedAt ?? check.startedAt}
      completedAt={matchingJob?.completedAt ?? check.completedAt}
      expandable={expandable}
    >
      {runId && (
        <>
          {matchingJob && (
            <JobStepsAccordion
              repoTarget={repoTarget}
              runId={runId}
              steps={matchingJob.steps}
            />
          )}
          {failed && (
            <AiFailureExplainer
              checkName={check.name}
              repoTarget={repoTarget}
              runId={runId}
            />
          )}
        </>
      )}
    </JobRow>
  );
}
