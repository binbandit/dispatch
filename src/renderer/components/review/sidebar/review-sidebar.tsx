/* eslint-disable import/max-dependencies -- ReviewSidebar intentionally composes several existing review panes. */
import { MergeReadinessCard } from "@/renderer/components/review/actions/merge-readiness-card";
import { FileTree } from "@/renderer/components/review/diff/file-tree";
import { TriageView } from "@/renderer/components/review/diff/triage-view";
import { QueueZone } from "@/renderer/components/review/sidebar/queue-zone";
import { FileTreeSkeleton } from "@/renderer/components/shared/loading-skeletons";
import { useAiTriageSections } from "@/renderer/hooks/ai/use-ai-triage-sections";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { isCompletedPullRequest } from "@/renderer/lib/review/completed-pr-state";
import { getDiffFilePath, parseDiff, type DiffFile } from "@/renderer/lib/review/diff-parser";
import { useFileNav } from "@/renderer/lib/review/file-nav-context";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { classifyFiles } from "@/renderer/lib/review/triage-classifier";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Review sidebar — PR-REVIEW-REDESIGN.md § Sidebar — Review (260px)
 *
 * Three zones: Queue (top), File Navigation (middle), Merge Readiness (bottom).
 * File navigation has Triage/Tree toggle.
 */

interface ReviewSidebarProps {
  prNumber: number;
  onBack: () => void;
  onSelectPr: (prNumber: number) => void;
}

export function ReviewSidebar({ prNumber, onBack, onSelectPr }: ReviewSidebarProps) {
  const { repoTarget, nwo, cwd } = useWorkspace();
  const {
    currentFileIndex,
    setCurrentFileIndex,
    setCurrentFilePath,
    selectedCommit,
    setSelectedCommit,
  } = useFileNav();

  // Diff data (shared query key with PrDetailView — React Query dedupes)
  const diffQuery = useQuery({
    queryKey: ["pr", "diff", nwo, prNumber],
    queryFn: () => ipc("pr.diff", { ...repoTarget, prNumber }),
    staleTime: 60_000,
  });

  // Commit-specific diff (only fetched when a commit is selected)
  const commitDiffQuery = useQuery({
    queryKey: ["git", "commitDiff", nwo, selectedCommit?.oid],
    queryFn: () => {
      if (!selectedCommit) {
        throw new Error("Commit diff requested without a selected commit.");
      }

      if (!cwd) {
        throw new Error("Commit diff requested without a workspace path.");
      }

      return ipc("git.commitDiff", { cwd, sha: selectedCommit.oid });
    },
    enabled: Boolean(selectedCommit) && cwd !== null,
    staleTime: 60_000,
  });

  const rawDiff = selectedCommit ? commitDiffQuery.data : diffQuery.data;
  const isLoadingDiff = selectedCommit ? commitDiffQuery.isLoading : diffQuery.isLoading;

  const files: DiffFile[] = useMemo(() => {
    if (!rawDiff) {
      return [];
    }
    return parseDiff(rawDiff);
  }, [rawDiff]);

  const handleSelectFile = useCallback(
    (index: number) => {
      setCurrentFileIndex(index);
      const file = files[index];
      setCurrentFilePath(file ? getDiffFilePath(file) : null);
    },
    [files, setCurrentFileIndex, setCurrentFilePath],
  );

  // View mode — user toggle overrides the saved preference (or auto default)
  // Force tree mode when viewing a specific commit
  const defaultFileNav = usePreference("defaultFileNav");
  const [viewModeOverride, setViewModeOverride] = useState<"triage" | "tree" | null>(null);
  const viewMode: "triage" | "tree" = selectedCommit
    ? "tree"
    : (viewModeOverride ??
      (defaultFileNav === "triage" || defaultFileNav === "tree"
        ? defaultFileNav
        : files.length > 5
          ? "triage"
          : "tree"));

  // Viewed files
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", nwo, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: nwo, prNumber }),
  });
  const viewedFiles = useMemo(() => new Set(viewedQuery.data), [viewedQuery.data]);
  const refetchViewedFiles = viewedQuery.refetch;

  // Comments for file badges
  const commentsQuery = useQuery({
    queryKey: ["pr", "comments", nwo, prNumber],
    queryFn: () => ipc("pr.comments", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  const fileCommentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commentsQuery.data ?? []) {
      if (c.path && c.line) {
        counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
      }
    }
    return counts;
  }, [commentsQuery.data]);

  // CI annotations for triage classification
  const annotationsQuery = useQuery({
    queryKey: ["checks", "annotations", nwo, prNumber],
    queryFn: () => ipc("checks.annotations", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  const annotationPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const a of annotationsQuery.data ?? []) {
      paths.add(a.path);
    }
    return paths;
  }, [annotationsQuery.data]);

  // Triage classification
  const triageGroups = useMemo(
    () => classifyFiles(files, fileCommentCounts, annotationPaths, viewedFiles),
    [files, fileCommentCounts, annotationPaths, viewedFiles],
  );

  // Queue (review-requested PRs — same query as inbox "Review" tab)
  const queueQuery = useQuery({
    queryKey: ["pr", "list", nwo, "reviewRequested"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });
  const queuePrs = queueQuery.data ?? [];

  // PR detail for merge readiness
  const detailQuery = useQuery({
    queryKey: ["pr", "detail", nwo, prNumber],
    queryFn: () => ipc("pr.detail", { ...repoTarget, prNumber }),
    refetchInterval: 60_000,
  });
  const pr = detailQuery.data;
  const isCompletedPr = pr ? isCompletedPullRequest(pr) : false;
  const { sections: triageSections, meta: triageMeta } = useAiTriageSections({
    nwo,
    prNumber,
    pr,
    files,
    triageGroups,
    fileCommentCounts,
    annotationPaths,
    viewedFiles,
    viewMode,
    isCommitView: Boolean(selectedCommit),
  });

  // Checks list — same query key as ChecksPanel so React Query dedupes.
  // Used for merge readiness so it stays in sync with the checks panel.
  const checksQuery = useQuery({
    queryKey: ["checks", "list", nwo, prNumber],
    queryFn: () => ipc("checks.list", { ...repoTarget, prNumber }),
    refetchInterval: 10_000,
  });
  const checksList = checksQuery.data ?? [];

  // File search
  const [fileSearch, setFileSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSetFilesViewed = useCallback(
    (filePaths: string[], viewed: boolean) => {
      void ipc("review.setFilesViewed", {
        repo: nwo,
        prNumber,
        filePaths,
        viewed,
      }).then(() => {
        void refetchViewedFiles();
      });
    },
    [nwo, prNumber, refetchViewedFiles],
  );

  const handleToggleViewed = useCallback(
    (filePath: string, viewed: boolean) => {
      handleSetFilesViewed([filePath], viewed);
    },
    [handleSetFilesViewed],
  );

  return (
    <div className="bg-bg-surface flex h-full flex-col">
      {/* Queue zone — only show queue list if there are PRs to review */}
      <QueueZone
        queuePrs={queuePrs}
        activePrNumber={prNumber}
        onBack={onBack}
        onSelectPr={onSelectPr}
        hideWhenEmpty
      />

      {/* Commit view banner */}
      {selectedCommit && (
        <div
          className="border-border-subtle flex items-center gap-2 border-b px-3 py-2"
          style={{ background: "rgba(91, 164, 230, 0.06)" }}
        >
          <button
            type="button"
            onClick={() => setSelectedCommit(null)}
            className="text-info hover:text-text-primary shrink-0 cursor-pointer text-[10px] font-medium transition-colors"
          >
            <ArrowLeft size={12} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-text-primary truncate text-[11px] font-medium">
              {selectedCommit.message.split("\n")[0]}
            </div>
            <div className="text-text-tertiary font-mono text-[10px]">
              {selectedCommit.oid.slice(0, 7)}
            </div>
          </div>
        </div>
      )}

      {/* View toggle — hidden when viewing a specific commit */}
      {!selectedCommit && (
        <div
          className="flex items-center gap-1.5"
          style={{ padding: "6px 10px 2px" }}
        >
          <div className="bg-bg-raised flex gap-px rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setViewModeOverride("triage")}
              className={`cursor-pointer rounded-sm text-[10px] font-medium select-none ${
                viewMode === "triage"
                  ? "bg-accent-muted text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-primary"
              }`}
              style={{ padding: "3px 10px" }}
            >
              Triage
            </button>
            <button
              type="button"
              onClick={() => setViewModeOverride("tree")}
              className={`cursor-pointer rounded-sm text-[10px] font-medium select-none ${
                viewMode === "tree"
                  ? "bg-accent-muted text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-primary"
              }`}
              style={{ padding: "3px 10px" }}
            >
              Tree
            </button>
          </div>
        </div>
      )}

      {/* File search */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="border-border bg-bg-raised flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search
            size={11}
            className="text-text-tertiary shrink-0"
          />
          <input
            ref={searchRef}
            type="text"
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            placeholder="Filter files..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] focus:outline-none"
          />
        </div>
      </div>

      {/* File list */}
      {isLoadingDiff ? (
        <FileTreeSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {viewMode === "triage" ? (
            <TriageView
              sections={triageSections}
              currentFileIndex={currentFileIndex}
              onSelectFile={handleSelectFile}
              viewedFiles={viewedFiles}
              commentCounts={fileCommentCounts}
              meta={triageMeta}
            />
          ) : (
            <div className="p-2">
              <FileTree
                files={files}
                currentFileIndex={currentFileIndex}
                onSelectFile={handleSelectFile}
                viewedFiles={selectedCommit ? new Set() : viewedFiles}
                commentCounts={selectedCommit ? new Map() : fileCommentCounts}
                nwo={nwo}
                prNumber={prNumber}
                onToggleViewed={selectedCommit || isCompletedPr ? undefined : handleToggleViewed}
                onSetFilesViewed={
                  selectedCommit || isCompletedPr ? undefined : handleSetFilesViewed
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Merge readiness card — hidden when viewing a specific commit */}
      {!selectedCommit &&
        pr &&
        !isCompletedPr &&
        (() => {
          const checkSummary = summarizePrChecks(checksList);

          // ReviewDecision is empty when branch protection doesn't require reviews.
          // Fall back to checking the reviews array for an actual approval.
          let hasApproval = pr.reviewDecision === "APPROVED";
          if (!hasApproval) {
            const latestByAuthor = new Map<string, string>();
            for (const r of pr.reviews) {
              if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") {
                latestByAuthor.set(r.author.login, r.state);
              }
            }
            hasApproval = [...latestByAuthor.values()].some((s) => s === "APPROVED");
          }

          return (
            <MergeReadinessCard
              hasApproval={hasApproval}
              allChecksPassing={
                checkSummary.failed === 0 && checkSummary.pending === 0 && checkSummary.total > 0
              }
              noConflicts={pr.mergeable === "MERGEABLE"}
              hasChecks={checkSummary.total > 0}
              isBehind={pr.mergeStateStatus === "BEHIND"}
              repoTarget={repoTarget}
              prNumber={prNumber}
            />
          );
        })()}
    </div>
  );
}
