import { FileTree } from "@/renderer/components/review/diff/file-tree";
import { FileTreeSkeleton } from "@/renderer/components/shared/loading-skeletons";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { isCompletedPullRequest } from "@/renderer/lib/review/completed-pr-state";
import { parseDiff, type DiffFile } from "@/renderer/lib/review/diff-parser";
import { useFileNav } from "@/renderer/lib/review/file-nav-context";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo } from "react";

/**
 * PR file sidebar — replaces the PR inbox when a PR is selected.
 *
 * Shows a back button + the file tree for the selected PR.
 * Shares currentFileIndex with the diff viewer via FileNavContext.
 */

interface PrFileSidebarProps {
  prNumber: number;
  onBack: () => void;
}

export function PrFileSidebar({ prNumber, onBack }: PrFileSidebarProps) {
  const { repoTarget, nwo } = useWorkspace();
  const { currentFileIndex, setCurrentFileIndex } = useFileNav();

  const detailQuery = useQuery({
    queryKey: ["pr", "detail", nwo, prNumber],
    queryFn: () => ipc("pr.detail", { ...repoTarget, prNumber }),
    refetchInterval: 60_000,
  });
  const isCompletedPr = detailQuery.data ? isCompletedPullRequest(detailQuery.data) : false;

  // Fetch diff (shared query key with PrDetail — React Query dedupes)
  const diffQuery = useQuery({
    queryKey: ["pr", "diff", nwo, prNumber],
    queryFn: () => ipc("pr.diff", { ...repoTarget, prNumber }),
    staleTime: 60_000,
  });

  const files: DiffFile[] = useMemo(() => {
    if (!diffQuery.data) {
      return [];
    }
    return parseDiff(diffQuery.data);
  }, [diffQuery.data]);

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
      {/* Header with back button */}
      <div className="border-border flex items-center border-b px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="text-text-secondary hover:text-text-primary flex cursor-pointer items-center gap-1.5 rounded-sm text-xs transition-colors"
        >
          <ArrowLeft size={14} />
          <span>All Pull Requests</span>
        </button>
      </div>

      {/* File tree */}
      {diffQuery.isLoading ? (
        <FileTreeSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          <FileTree
            files={files}
            currentFileIndex={currentFileIndex}
            onSelectFile={setCurrentFileIndex}
            viewedFiles={viewedFiles}
            commentCounts={fileCommentCounts}
            nwo={nwo}
            prNumber={prNumber}
            onToggleViewed={isCompletedPr ? undefined : handleToggleViewed}
            onSetFilesViewed={isCompletedPr ? undefined : handleSetFilesViewed}
          />
        </div>
      )}
    </div>
  );
}
