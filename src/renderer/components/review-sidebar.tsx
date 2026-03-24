import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { parseDiff, type DiffFile } from "../lib/diff-parser";
import { useFileNav } from "../lib/file-nav-context";
import { ipc } from "../lib/ipc";
import { summarizePrChecks } from "../lib/pr-check-status";
import { classifyFiles } from "../lib/triage-classifier";
import { useWorkspace } from "../lib/workspace-context";
import { FileTree } from "./file-tree";
import { FileTreeSkeleton } from "./loading-skeletons";
import { MergeReadinessCard } from "./merge-readiness-card";
import { QueueZone } from "./queue-zone";
import { TriageView } from "./triage-view";

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
  const { cwd } = useWorkspace();
  const { currentFileIndex, setCurrentFileIndex } = useFileNav();
  const repoName = cwd.split("/").pop() ?? "";

  // Diff data (shared query key with PrDetailView — React Query dedupes)
  const diffQuery = useQuery({
    queryKey: ["pr", "diff", cwd, prNumber],
    queryFn: () => ipc("pr.diff", { cwd, prNumber }),
    staleTime: 60_000,
  });

  const files: DiffFile[] = useMemo(() => {
    if (!diffQuery.data) {
      return [];
    }
    return parseDiff(diffQuery.data);
  }, [diffQuery.data]);

  // Default view mode based on file count
  const [viewMode, setViewMode] = useState<"triage" | "tree">(() =>
    files.length > 5 ? "triage" : "tree",
  );

  // Viewed files
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", repoName, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: repoName, prNumber }),
  });
  const viewedFiles = useMemo(() => new Set(viewedQuery.data), [viewedQuery.data]);

  // Comments for file badges
  const commentsQuery = useQuery({
    queryKey: ["pr", "comments", cwd, prNumber],
    queryFn: () => ipc("pr.comments", { cwd, prNumber }),
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
    queryKey: ["checks", "annotations", cwd, prNumber],
    queryFn: () => ipc("checks.annotations", { cwd, prNumber }),
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
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });
  const queuePrs = queueQuery.data ?? [];

  // PR detail for merge readiness
  const detailQuery = useQuery({
    queryKey: ["pr", "detail", cwd, prNumber],
    queryFn: () => ipc("pr.detail", { cwd, prNumber }),
    refetchInterval: 60_000,
  });
  const pr = detailQuery.data;

  // File search
  const [fileSearch, setFileSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Progress info
  const attentionCount = triageGroups.attention.length;
  const viewedCount = viewedFiles.size;

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

      {/* View toggle */}
      <div
        className="flex items-center gap-1.5"
        style={{ padding: "6px 10px 2px" }}
      >
        <div className="bg-bg-raised flex gap-px rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("triage")}
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
            onClick={() => setViewMode("tree")}
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

      {/* Progress bar */}
      <div
        className="border-border-subtle flex items-center gap-2 border-b"
        style={{ padding: "5px 12px" }}
      >
        <div
          className="bg-bg-raised flex-1 overflow-hidden rounded-full"
          style={{ height: "3px" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: files.length > 0 ? `${(viewedCount / files.length) * 100}%` : "0%",
              background:
                viewMode === "triage" && attentionCount > 0
                  ? "var(--accent-text)"
                  : "var(--accent)",
            }}
          />
        </div>
        <span
          className="font-mono text-[10px] whitespace-nowrap"
          style={{
            color:
              viewMode === "triage" && attentionCount > 0
                ? "var(--accent-text)"
                : "var(--text-tertiary)",
          }}
        >
          {viewMode === "triage" && attentionCount > 0
            ? `${attentionCount} need attention · ${viewedCount}/${files.length} viewed`
            : `${viewedCount}/${files.length} viewed`}
        </span>
      </div>

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
      {diffQuery.isLoading ? (
        <FileTreeSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {viewMode === "triage" ? (
            <TriageView
              groups={triageGroups}
              currentFileIndex={currentFileIndex}
              onSelectFile={setCurrentFileIndex}
              viewedFiles={viewedFiles}
              commentCounts={fileCommentCounts}
            />
          ) : (
            <div className="p-2">
              <FileTree
                files={files}
                currentFileIndex={currentFileIndex}
                onSelectFile={setCurrentFileIndex}
                viewedFiles={viewedFiles}
                commentCounts={fileCommentCounts}
                cwd={cwd}
                prNumber={prNumber}
                onToggleViewed={(filePath, viewed) => {
                  ipc("review.setFileViewed", {
                    repo: repoName,
                    prNumber,
                    filePath,
                    viewed,
                  }).then(() => {
                    viewedQuery.refetch();
                  });
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Merge readiness card */}
      {pr &&
        (() => {
          const checkSummary = summarizePrChecks(pr.statusCheckRollup);

          // reviewDecision is empty when branch protection doesn't require reviews.
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
              cwd={cwd}
              prNumber={prNumber}
            />
          );
        })()}
    </div>
  );
}
