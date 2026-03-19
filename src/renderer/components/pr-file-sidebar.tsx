import type { DiffFile } from "../lib/diff-parser";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";

import { parseDiff } from "../lib/diff-parser";
import { useFileNav } from "../lib/file-nav-context";
import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";
import { FileTree } from "./file-tree";
import { FileTreeSkeleton } from "./loading-skeletons";

/**
 * PR file sidebar — replaces the PR inbox when a PR is selected.
 *
 * Shows a back button + the file tree for the selected PR.
 * Shares currentFileIndex with the diff viewer via FileNavContext.
 */

interface PrFileSidebarProps {
  prNumber: number;
  onBack: () => void;
  prTitle: string;
}

export function PrFileSidebar({ prNumber, onBack, prTitle }: PrFileSidebarProps) {
  const { cwd } = useWorkspace();
  const { currentFileIndex, setCurrentFileIndex } = useFileNav();

  const repoName = cwd.split("/").pop() ?? "";

  // Fetch diff (shared query key with PrDetail — React Query dedupes)
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

  // Viewed files
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", repoName, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: repoName, prNumber }),
  });
  const viewedFiles = useMemo(() => new Set(viewedQuery.data ?? []), [viewedQuery.data]);

  // Comments for file badges
  const commentsQuery = useQuery({
    queryKey: ["pr", "comments", cwd, prNumber],
    queryFn: () => ipc("pr.comments", { cwd, prNumber }),
    staleTime: 30_000,
  });

  const fileCommentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commentsQuery.data ?? []) {
      if (c.path) {
        counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
      }
    }
    return counts;
  }, [commentsQuery.data]);

  return (
    <div className="bg-bg-surface flex h-full flex-col">
      {/* Header with back button */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary truncate text-xs font-medium">{prTitle}</p>
          <p className="text-text-tertiary font-mono text-[10px]">#{prNumber}</p>
        </div>
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
  );
}
