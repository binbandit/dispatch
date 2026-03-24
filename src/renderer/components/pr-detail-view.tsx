import type { Annotation } from "./ci-annotation";
import type { ReviewComment } from "./inline-comment";

import { Spinner } from "@/components/ui/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { useSyntaxHighlighter } from "../hooks/use-syntax-highlight";
import { getDiffFilePath, parseDiff, type DiffFile } from "../lib/diff-parser";
import { useFileNav } from "../lib/file-nav-context";
import { ensureLanguage, inferLanguage } from "../lib/highlighter";
import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { CompactPrHeader } from "./compact-pr-header";
import { DiffToolbar } from "./diff-toolbar";
import { DiffViewer, type CommentRange, type DiffMode } from "./diff-viewer";
import { EmptyState } from "./empty-state";
import { FloatingReviewBar } from "./floating-review-bar";
import { PrDetailSkeleton } from "./loading-skeletons";
import { SidePanelOverlay, type PanelTab } from "./side-panel-overlay";

/**
 * PR detail view — DISPATCH-DESIGN-SYSTEM.md § 8.5, 8.6, 8.7, 8.8
 *
 * Differentiates between author and reviewer:
 * - Reviewer: Approve / Request Changes actions, diff-first experience
 * - Author: Ship-focused — CI status, merge controls, PR body/conversation
 */

interface PrDetailViewProps {
  prNumber: number | null;
}

export function PrDetailView({ prNumber }: PrDetailViewProps) {
  if (!prNumber) {
    return <EmptyState />;
  }
  return <PrDetail prNumber={prNumber} />;
}

// ---------------------------------------------------------------------------
// Main PR detail (with data)
// ---------------------------------------------------------------------------

function PrDetail({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const { currentFileIndex, setCurrentFileIndex } = useFileNav();
  const [diffMode, setDiffMode] = useState<"all" | "since-review">("all");
  const [viewMode, setViewMode] = useState<DiffMode>("unified");
  const [showFullFile, setShowFullFile] = useState(false);
  const [activeComposer, setActiveComposer] = useState<CommentRange | null>(null);

  const highlighter = useSyntaxHighlighter();

  // Repo info (for admin permissions)
  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", cwd],
    queryFn: () => ipc("repo.info", { cwd }),
    staleTime: 300_000,
  });
  const canPush = repoInfoQuery.data?.canPush ?? false;

  // Current user (for author vs reviewer detection)
  const userQuery = useQuery({
    queryKey: ["env", "user"],
    queryFn: () => ipc("env.user"),
    staleTime: 300_000,
  });
  const currentUser = userQuery.data?.login ?? null;

  // PR detail
  const detailQuery = useQuery({
    queryKey: ["pr", "detail", cwd, prNumber],
    queryFn: () => ipc("pr.detail", { cwd, prNumber }),
    refetchInterval: 60_000,
  });
  const markPrActivitySeenMutation = useMutation({
    mutationFn: (args: { repo: string; prNumber: number; updatedAt: string }) =>
      ipc("prActivity.markSeen", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr-activity"] });
    },
  });
  const hasMarkedPrActivityRef = useRef(false);

  useEffect(() => {
    hasMarkedPrActivityRef.current = false;
  }, [cwd, prNumber]);

  useEffect(() => {
    if (
      !detailQuery.data?.updatedAt ||
      !detailQuery.isFetchedAfterMount ||
      hasMarkedPrActivityRef.current
    ) {
      return;
    }

    hasMarkedPrActivityRef.current = true;
    markPrActivitySeenMutation.mutate({
      repo: cwd,
      prNumber,
      updatedAt: detailQuery.data.updatedAt,
    });
  }, [
    cwd,
    detailQuery.data?.updatedAt,
    detailQuery.isFetchedAfterMount,
    markPrActivitySeenMutation,
    prNumber,
  ]);

  // Full PR diff
  const diffQuery = useQuery({
    queryKey: ["pr", "diff", cwd, prNumber],
    queryFn: () => ipc("pr.diff", { cwd, prNumber }),
    staleTime: 60_000,
  });

  // Review rounds
  const repoName = cwd.split("/").pop() ?? "";
  const lastShaQuery = useQuery({
    queryKey: ["review", "getLastSha", repoName, prNumber],
    queryFn: () => ipc("review.getLastSha", { repo: repoName, prNumber }),
  });
  const lastSha = lastShaQuery.data ?? null;
  const headSha = detailQuery.data?.headRefOid ?? "";

  // Incremental diff
  const incrementalDiffQuery = useQuery({
    queryKey: ["git", "diff", cwd, lastSha, headSha],
    queryFn: () => ipc("git.diff", { cwd, fromRef: lastSha ?? "", toRef: headSha }),
    enabled: diffMode === "since-review" && !!lastSha && !!headSha && lastSha !== headSha,
    staleTime: 60_000,
  });

  // Save review SHA is available for the toolbar's "mark reviewed" action
  // Currently the toolbar uses a "Viewed" toggle per-file instead

  // Parse diff
  const rawDiff =
    diffMode === "since-review" && incrementalDiffQuery.data
      ? incrementalDiffQuery.data
      : diffQuery.data;

  const files: DiffFile[] = useMemo(() => {
    if (!rawDiff) {
      return [];
    }
    return parseDiff(rawDiff);
  }, [rawDiff]);

  // PR review comments (inline on code)
  const commentsQuery = useQuery({
    queryKey: ["pr", "comments", cwd, prNumber],
    queryFn: () => ipc("pr.comments", { cwd, prNumber }),
    staleTime: 30_000,
  });

  // PR issue comments (general conversation)
  const issueCommentsQuery = useQuery({
    queryKey: ["pr", "issueComments", cwd, prNumber],
    queryFn: () => ipc("pr.issueComments", { cwd, prNumber }),
    staleTime: 30_000,
  });

  const commentsMap = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of commentsQuery.data ?? []) {
      if (!c.line) {
        continue;
      }
      const key = `${c.path}:${c.line}`;
      const existing = map.get(key) ?? [];
      existing.push(c);
      map.set(key, existing);
    }
    return map;
  }, [commentsQuery.data]);

  // CI annotations
  const annotationsQuery = useQuery({
    queryKey: ["checks", "annotations", cwd, prNumber],
    queryFn: () => ipc("checks.annotations", { cwd, prNumber }),
    staleTime: 30_000,
  });

  const annotationsMap = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotationsQuery.data ?? []) {
      for (let line = a.startLine; line <= a.endLine; line++) {
        const key = `${a.path}:${line}`;
        const existing = map.get(key) ?? [];
        existing.push(a);
        map.set(key, existing);
      }
    }
    return map;
  }, [annotationsQuery.data]);

  const currentFile = files[currentFileIndex] ?? null;
  const currentFilePath = currentFile ? getDiffFilePath(currentFile) : "";
  const currentLanguage = inferLanguage(currentFilePath);

  // Ensure the language is loaded for the current file (lazy-load non-core langs)
  if (highlighter && currentLanguage !== "text") {
    ensureLanguage(currentLanguage);
  }

  // Full file content (for "show full file" mode)
  const fullFileQuery = useQuery({
    queryKey: ["git", "showFile", cwd, headSha, currentFilePath],
    queryFn: () => ipc("git.showFile", { cwd, ref: headSha || "HEAD", filePath: currentFilePath }),
    enabled: showFullFile && !!currentFilePath,
    staleTime: 120_000,
  });

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("overview");
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);

  // State for visually highlighting a comment after navigation
  const [highlightedComment, setHighlightedComment] = useState<{
    login: string;
    expiresAt: number;
  } | null>(null);

  // Navigate to a reviewer's first inline comment in the diff
  const handleReviewClick = useCallback(
    (login: string) => {
      const allComments = commentsQuery.data ?? [];
      // Find this reviewer's inline comments (ones with path + line)
      const reviewerComments = allComments
        .filter((c) => c.user.login === login && c.path && c.line)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (reviewerComments.length > 0) {
        const firstComment = reviewerComments[0]!;
        // Find the file index for this comment
        const fileIndex = files.findIndex((f) => getDiffFilePath(f) === firstComment.path);
        if (fileIndex >= 0) {
          setCurrentFileIndex(fileIndex);
        }
      } else {
        // No inline comments — open the panel and highlight the review
        setPanelTab("conversation");
        setPanelOpen(true);
        setHighlightedComment({ login, expiresAt: Date.now() + 2000 });
        setTimeout(() => setHighlightedComment(null), 2000);
      }
    },
    [commentsQuery.data, files, setCurrentFileIndex],
  );

  // File navigation
  const goToPrevFile = useCallback(() => {
    setCurrentFileIndex(Math.max(0, currentFileIndex - 1));
  }, [currentFileIndex, setCurrentFileIndex]);
  const goToNextFile = useCallback(() => {
    setCurrentFileIndex(Math.min(files.length - 1, currentFileIndex + 1));
  }, [currentFileIndex, files.length, setCurrentFileIndex]);

  // Viewed files (shared query key — React Query dedupes with sidebar)
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", repoName, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: repoName, prNumber }),
  });

  // Toggle viewed state for current file via `v` key
  const handleToggleViewed = useCallback(() => {
    if (!currentFilePath) {
      return;
    }
    const isCurrentlyViewed = viewedQuery.data?.includes(currentFilePath) ?? false;
    ipc("review.setFileViewed", {
      repo: repoName,
      prNumber,
      filePath: currentFilePath,
      viewed: !isCurrentlyViewed,
    }).then(() => viewedQuery.refetch());
  }, [currentFilePath, prNumber, repoName, viewedQuery]);

  // Keyboard shortcuts — centralized via useKeyboardShortcuts
  useKeyboardShortcuts([
    { key: "[", handler: goToPrevFile },
    { key: "]", handler: goToNextFile },
    { key: "i", handler: togglePanel },
    {
      key: "|",
      modifiers: ["meta", "shift"],
      handler: () => {
        setPanelTab("conversation");
        setPanelOpen(true);
      },
    },
    { key: "v", handler: handleToggleViewed },
    {
      key: "n",
      handler: () => {
        // Jump to next unviewed file
        const viewed = new Set(viewedQuery.data ?? []);
        for (let i = currentFileIndex + 1; i < files.length; i++) {
          const path = getDiffFilePath(files[i]!);
          if (!viewed.has(path)) {
            setCurrentFileIndex(i);
            return;
          }
        }
        // Wrap around
        for (let i = 0; i < currentFileIndex; i++) {
          const path = getDiffFilePath(files[i]!);
          if (!viewed.has(path)) {
            setCurrentFileIndex(i);
            return;
          }
        }
      },
    },
  ]);

  // Loading
  if (detailQuery.isLoading) {
    return <PrDetailSkeleton />;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-destructive text-sm">Failed to load PR #{prNumber}</p>
      </div>
    );
  }

  const pr = detailQuery.data;
  const totalAdditions = pr.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = pr.files.reduce((sum, f) => sum + f.deletions, 0);
  const isAuthor = currentUser !== null && pr.author.login === currentUser;
  // Derive repo "owner/repo" from the PR URL for #123 linkification
  const repoSlug = pr.url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? "";

  // Always show the panel toggle — the Overview tab is useful even without conversation
  const showPanelToggle = true;

  // Current user's most recent review state for the floating bar
  const currentUserReview = currentUser
    ? (pr.reviews
        .filter((r) => r.author.login === currentUser)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0]
        ?.state ?? null)
    : null;

  // Count inline comments for the floating bar
  const totalCommentCount = commentsQuery.data?.length ?? 0;

  const viewedCount = viewedQuery.data?.length ?? 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Compact PR Header (36px) */}
      <CompactPrHeader
        pr={pr}
        isAuthor={isAuthor}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        cwd={cwd}
        totalAdditions={totalAdditions}
        totalDeletions={totalDeletions}
        showPanelToggle={showPanelToggle}
      />

      {/* Diff viewer area (relative for overlay positioning) */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <DiffToolbar
            currentFile={currentFile}
            currentIndex={currentFileIndex}
            totalFiles={files.length}
            onPrev={goToPrevFile}
            onNext={goToNextFile}
            diffMode={diffMode}
            onDiffModeChange={setDiffMode}
            hasLastReview={!!lastSha && lastSha !== headSha}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showFullFile={showFullFile}
            onToggleFullFile={() => setShowFullFile((v) => !v)}
            isViewed={
              currentFilePath ? (viewedQuery.data?.includes(currentFilePath) ?? false) : false
            }
            onToggleViewed={() => {
              if (currentFilePath) {
                const isCurrentlyViewed = viewedQuery.data?.includes(currentFilePath) ?? false;
                ipc("review.setFileViewed", {
                  repo: repoName,
                  prNumber,
                  filePath: currentFilePath,
                  viewed: !isCurrentlyViewed,
                }).then(() => viewedQuery.refetch());
              }
            }}
          />

          {diffQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-primary h-4 w-4" />
            </div>
          ) : currentFile ? (
            <DiffViewer
              file={currentFile}
              highlighter={highlighter}
              language={inferLanguage(getDiffFilePath(currentFile))}
              comments={commentsMap}
              annotations={annotationsMap}
              prNumber={prNumber}
              activeComposer={activeComposer}
              onCommentRange={setActiveComposer}
              onCloseComposer={() => setActiveComposer(null)}
              fullFileContent={showFullFile ? (fullFileQuery.data ?? null) : null}
              diffMode={viewMode}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-text-tertiary text-xs">No files changed</p>
            </div>
          )}
        </div>

        {/* Side panel overlay (380px, slides from right) */}
        <SidePanelOverlay
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          pr={pr}
          prNumber={prNumber}
          issueComments={issueCommentsQuery.data ?? []}
          repo={repoSlug}
          highlightedLogin={highlightedComment?.login ?? null}
          onReviewClick={handleReviewClick}
          diffSnippet={rawDiff ?? ""}
          activeTab={panelTab}
          onTabChange={setPanelTab}
        />

        {/* Floating review bar */}
        <FloatingReviewBar
          viewedCount={viewedCount}
          totalFiles={files.length}
          commentCount={totalCommentCount}
          checkSummary={pr.statusCheckRollup}
          isAuthor={isAuthor}
          isDraft={pr.isDraft}
          pr={pr}
          cwd={cwd}
          prNumber={prNumber}
          canAdmin={canPush}
          currentUserReview={currentUserReview}
          panelOpen={panelOpen}
        />
      </div>
    </div>
  );
}
