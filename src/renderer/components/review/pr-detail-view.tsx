import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";
import type { Annotation } from "@/renderer/components/review/diff/ci-annotation";
/* eslint-disable import/max-dependencies, no-continue, @typescript-eslint/no-non-null-assertion, unicorn/no-useless-collection-argument -- This PR detail surface is an intentional composition root with guarded query-driven state. */
import type { AiSuggestion } from "@/renderer/lib/review/ai-suggestions";
import type { GhPrDetail } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { FloatingReviewBar } from "@/renderer/components/review/actions/floating-review-bar";
import { DiffToolbar } from "@/renderer/components/review/diff/diff-toolbar";
import {
  DiffViewer,
  type CommentRange,
  type DiffMode,
} from "@/renderer/components/review/diff/diff-viewer";
import { EmptyState } from "@/renderer/components/shared/empty-state";
import { PrDetailSkeleton } from "@/renderer/components/shared/loading-skeletons";
import { useAiSuggestions } from "@/renderer/hooks/ai/use-ai-suggestions";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { useSyntaxHighlighter } from "@/renderer/hooks/review/use-syntax-highlight";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useTheme } from "@/renderer/lib/app/theme-context";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  getCompletedPullRequestLabel,
  getCompletedPullRequestTimestamp,
  isCompletedPullRequest,
} from "@/renderer/lib/review/completed-pr-state";
import { getDiffFilePath, parseDiff, type DiffFile } from "@/renderer/lib/review/diff-parser";
import { useFileNav } from "@/renderer/lib/review/file-nav-context";
import { ensureLanguage, ensureTheme, inferLanguage } from "@/renderer/lib/review/highlighter";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitCommitHorizontal, GitMerge, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CompactPrHeader } from "./compact-pr-header";
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
  const { currentFileIndex, setCurrentFileIndex, selectedCommit, setSelectedCommit } = useFileNav();
  const defaultDiffView = usePreference("defaultDiffView");
  const [diffMode, setDiffMode] = useState<"all" | "since-review">("all");
  const [viewModeOverride, setViewModeOverride] = useState<DiffMode | null>(null);
  const viewMode: DiffMode =
    viewModeOverride ??
    (defaultDiffView === "split"
      ? "split"
      : defaultDiffView === "full-file"
        ? "full-file"
        : "unified");
  const setViewMode = setViewModeOverride;
  const showFullFile = viewMode === "full-file";
  const [activeComposer, setActiveComposer] = useState<CommentRange | null>(null);

  const highlighter = useSyntaxHighlighter();

  // Repo info (for admin permissions)
  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", cwd],
    queryFn: () => ipc("repo.info", { cwd }),
    staleTime: 300_000,
  });
  const canPush = repoInfoQuery.data?.canPush ?? false;
  const hasMergeQueue = repoInfoQuery.data?.hasMergeQueue ?? false;

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

  // Reset flags when PR changes (render-time ref adjustment)
  const prevCwdRef = useRef(cwd);
  const prevPrNumberRef = useRef(prNumber);
  if (prevCwdRef.current !== cwd || prevPrNumberRef.current !== prNumber) {
    prevCwdRef.current = cwd;
    prevPrNumberRef.current = prNumber;
    hasMarkedPrActivityRef.current = false;
    if (selectedCommit) {
      setSelectedCommit(null);
    }
  }

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

  // Commit-specific diff (only fetched when a commit is selected)
  const commitDiffQuery = useQuery({
    queryKey: ["git", "commitDiff", cwd, selectedCommit?.oid],
    queryFn: () => ipc("git.commitDiff", { cwd, sha: selectedCommit!.oid }),
    enabled: Boolean(selectedCommit),
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
    enabled:
      !selectedCommit &&
      diffMode === "since-review" &&
      Boolean(lastSha) &&
      Boolean(headSha) &&
      lastSha !== headSha,
    staleTime: 60_000,
  });

  // Parse diff — commit diff takes priority when selected
  const rawDiff = selectedCommit
    ? commitDiffQuery.data
    : diffMode === "since-review" && incrementalDiffQuery.data
      ? incrementalDiffQuery.data
      : diffQuery.data;

  const isLoadingDiff = selectedCommit ? commitDiffQuery.isLoading : diffQuery.isLoading;

  const files: DiffFile[] = useMemo(() => {
    if (!rawDiff) {
      return [];
    }
    return parseDiff(rawDiff);
  }, [rawDiff]);

  // PR review comments (inline on code) — empty when viewing a commit
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

  const emptyCommentsMap = useMemo(() => new Map<string, ReviewComment[]>(), []);
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

  // CI annotations — empty when viewing a commit
  const annotationsQuery = useQuery({
    queryKey: ["checks", "annotations", cwd, prNumber],
    queryFn: () => ipc("checks.annotations", { cwd, prNumber }),
    staleTime: 30_000,
  });

  const emptyAnnotationsMap = useMemo(() => new Map<string, Annotation[]>(), []);
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

  // Review threads (for resolved/unresolved state)
  const reviewThreadsQuery = useQuery({
    queryKey: ["pr", "reviewThreads", cwd, prNumber],
    queryFn: () => ipc("pr.reviewThreads", { cwd, prNumber }),
    staleTime: 30_000,
  });

  // Reactions (PR body + all comments)
  const reactionsQuery = useQuery({
    queryKey: ["pr", "reactions", cwd, prNumber],
    queryFn: () => ipc("pr.reactions", { cwd, prNumber }),
    staleTime: 30_000,
  });

  const aiEnabled = usePreference("aiEnabled") === "true";
  const prDetail = detailQuery.data;
  const {
    suggestionsForFile,
    isGenerating: isAiGenerating,
    generateForFile,
    autoTriggerFile,
    postComment: postSuggestion,
    dismiss: dismissSuggestion,
  } = useAiSuggestions({
    prNumber,
    prTitle: prDetail?.title ?? "",
    prBody: prDetail?.body ?? "",
    files,
    rawDiff: rawDiff ?? null,
    existingComments: commentsQuery.data ?? [],
    enabled: aiEnabled,
  });

  const currentFile = files[currentFileIndex] ?? null;
  const currentFilePath = currentFile ? getDiffFilePath(currentFile) : "";
  const currentLanguage = inferLanguage(currentFilePath);

  useEffect(() => {
    if (currentFilePath) {
      return autoTriggerFile(currentFilePath);
    }
  }, [currentFilePath, autoTriggerFile]);

  const aiSuggestionsMap = useMemo(() => {
    if (!currentFilePath) {
      return;
    }
    const suggestions = suggestionsForFile(currentFilePath);
    if (suggestions.length === 0) {
      return;
    }
    const map = new Map<string, AiSuggestion[]>();
    for (const s of suggestions) {
      const key = `${s.path}:${s.line}`;
      const existing = map.get(key) ?? [];
      existing.push(s);
      map.set(key, existing);
    }
    return map;
  }, [currentFilePath, suggestionsForFile]);

  const { codeTheme } = useTheme();

  // Ensure the language and code theme are loaded (lazy-load non-core langs & themes)
  if (highlighter && currentLanguage !== "text") {
    ensureLanguage(currentLanguage);
  }
  if (highlighter) {
    ensureTheme(codeTheme);
  }

  // Full file content (for "show full file" mode)
  const fullFileRef = selectedCommit ? selectedCommit.oid : headSha || "HEAD";
  const fullFileQuery = useQuery({
    queryKey: ["gh", "fileAtRef", cwd, fullFileRef, currentFilePath],
    queryFn: () => ipc("gh.fileAtRef", { cwd, ref: fullFileRef, filePath: currentFilePath }),
    enabled: showFullFile && Boolean(currentFilePath) && Boolean(fullFileRef),
    staleTime: 120_000,
  });

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("overview");
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);

  // State for visually highlighting a comment after navigation
  const [highlightedComment, setHighlightedComment] = useState<{
    login: string;
    expiresAt: number;
  } | null>(null);

  // Navigate to a reviewer's first inline comment in the diff
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleReviewClick = useCallback(
    (login: string) => {
      const allComments = commentsQuery.data ?? [];
      // Find this reviewer's inline comments (ones with path + line)
      const reviewerComments = allComments
        .filter((c) => c.user.login === login && c.path && c.line)
        .toSorted((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (reviewerComments.length > 0) {
        const firstComment = reviewerComments[0]!;
        // Find the file index for this comment
        const fileIndex = files.findIndex((f) => getDiffFilePath(f) === firstComment.path);
        if (fileIndex !== -1) {
          setCurrentFileIndex(fileIndex);
        }
      } else {
        // No inline comments — open the panel and highlight the review
        setPanelTab("conversation");
        setPanelOpen(true);
        setHighlightedComment({ login, expiresAt: Date.now() + 2000 });
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => setHighlightedComment(null), 2000);
      }
    },
    [commentsQuery.data, files, setCurrentFileIndex],
  );

  // Clean up highlight timer on unmount
  useEffect(
    () => () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    },
    [],
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
    if (!currentFilePath || selectedCommit) {
      return;
    }
    const isCurrentlyViewed = viewedQuery.data?.includes(currentFilePath) ?? false;
    ipc("review.setFileViewed", {
      repo: repoName,
      prNumber,
      filePath: currentFilePath,
      viewed: !isCurrentlyViewed,
    })
      .then(() => viewedQuery.refetch())
      .catch(() => {
        toastManager.add({ title: "Failed to update viewed state", type: "error" });
      });
  }, [currentFilePath, prNumber, repoName, selectedCommit, viewedQuery]);

  // Keyboard shortcuts — centralized via useKeyboardShortcuts
  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    { ...getBinding("navigation.prevFile"), handler: goToPrevFile },
    { ...getBinding("navigation.nextFile"), handler: goToNextFile },
    { ...getBinding("actions.togglePanel"), handler: togglePanel },
    {
      ...getBinding("actions.openConversation"),
      handler: () => {
        setPanelTab("conversation");
        setPanelOpen(true);
      },
    },
    { ...getBinding("actions.toggleViewed"), handler: handleToggleViewed },
    {
      ...getBinding("actions.nextUnreviewed"),
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

  // Build set of resolved thread IDs for inline comment display
  const resolvedThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const thread of reviewThreadsQuery.data ?? []) {
      if (thread.isResolved) {
        ids.add(thread.id);
      }
    }
    return ids;
  }, [reviewThreadsQuery.data]);
  const emptyResolvedIds = useMemo(() => new Set<string>(), []);

  // Check if the current user has been re-requested for review (e.g. after new commits)
  const reviewRequestsQuery = useQuery({
    queryKey: ["pr", "reviewRequests", cwd, prNumber],
    queryFn: () => ipc("pr.reviewRequests", { cwd, prNumber }),
  });

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
  const isCompletedPr = isCompletedPullRequest(pr);
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
        .toSorted(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
        )[0]?.state ?? null)
    : null;

  const isReRequested =
    currentUser !== null && (reviewRequestsQuery.data ?? []).some((rr) => rr.login === currentUser);

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
        isRefreshing={detailQuery.isFetching}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["pr"] });
          queryClient.invalidateQueries({ queryKey: ["checks"] });
          queryClient.invalidateQueries({ queryKey: ["pr-activity"] });
        }}
        canEdit={canPush}
      />
      {isCompletedPr && <CompletedPrBanner pr={pr} />}

      {/* Commit view banner */}
      {selectedCommit && (
        <div
          className="border-border-subtle flex shrink-0 items-center gap-2 border-b px-3"
          style={{
            height: "28px",
            background: "rgba(91, 164, 230, 0.06)",
          }}
        >
          <GitCommitHorizontal
            size={12}
            className="text-info shrink-0"
          />
          <span className="text-info text-[11px] font-medium">Viewing commit</span>
          <span
            className="text-info bg-info-muted shrink-0 rounded-sm font-mono text-[10px]"
            style={{ padding: "1px 5px" }}
          >
            {selectedCommit.oid.slice(0, 7)}
          </span>
          <span className="text-text-secondary min-w-0 truncate text-[11px]">
            {selectedCommit.message.split("\n")[0]}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelectedCommit(null)}
            className="text-info hover:text-text-primary flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-[rgba(91,164,230,0.1)]"
          >
            <ArrowLeft size={11} />
            All changes
          </button>
        </div>
      )}

      {/* Diff viewer area (relative for overlay positioning) */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <DiffToolbar
            currentFile={currentFile}
            currentIndex={currentFileIndex}
            totalFiles={files.length}
            onPrev={goToPrevFile}
            onNext={goToNextFile}
            diffMode={selectedCommit ? "all" : diffMode}
            onDiffModeChange={setDiffMode}
            hasLastReview={!selectedCommit && Boolean(lastSha) && lastSha !== headSha}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            isViewed={
              selectedCommit
                ? false
                : currentFilePath
                  ? (viewedQuery.data?.includes(currentFilePath) ?? false)
                  : false
            }
            onToggleViewed={() => {
              if (currentFilePath && !selectedCommit) {
                const isCurrentlyViewed = viewedQuery.data?.includes(currentFilePath) ?? false;
                ipc("review.setFileViewed", {
                  repo: repoName,
                  prNumber,
                  filePath: currentFilePath,
                  viewed: !isCurrentlyViewed,
                })
                  .then(() => viewedQuery.refetch())
                  .catch(() => {
                    toastManager.add({ title: "Failed to update viewed state", type: "error" });
                  });
              }
            }}
            hideReviewControls={Boolean(selectedCommit)}
            onAiSuggest={
              aiEnabled && currentFilePath ? () => generateForFile(currentFilePath) : undefined
            }
            isAiSuggesting={currentFilePath ? isAiGenerating(currentFilePath) : false}
            aiSuggestEnabled={aiEnabled}
          />

          {isLoadingDiff ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-primary h-4 w-4" />
            </div>
          ) : currentFile ? (
            <DiffViewer
              key={`${selectedCommit?.oid ?? headSha ?? "head"}:${currentFilePath}:${viewMode}`}
              file={currentFile}
              highlighter={highlighter}
              language={inferLanguage(getDiffFilePath(currentFile))}
              comments={selectedCommit ? emptyCommentsMap : commentsMap}
              annotations={selectedCommit ? emptyAnnotationsMap : annotationsMap}
              prNumber={prNumber}
              activeComposer={selectedCommit || isCompletedPr ? null : activeComposer}
              onCommentRange={selectedCommit || isCompletedPr ? undefined : setActiveComposer}
              onCloseComposer={
                selectedCommit || isCompletedPr ? undefined : () => setActiveComposer(null)
              }
              fullFileContent={showFullFile ? (fullFileQuery.data ?? null) : null}
              diffMode={viewMode}
              resolvedThreadIds={selectedCommit ? emptyResolvedIds : resolvedThreadIds}
              reviewCommentReactions={
                selectedCommit ? undefined : reactionsQuery.data?.reviewComments
              }
              aiSuggestions={selectedCommit ? undefined : aiSuggestionsMap}
              onPostSuggestion={postSuggestion}
              onDismissSuggestion={dismissSuggestion}
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
          reviewThreads={reviewThreadsQuery.data}
          reactions={reactionsQuery.data}
          canEdit={canPush}
        />

        {/* Floating review bar — hidden when viewing a specific commit */}
        {!selectedCommit && !isCompletedPr && (
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
            hasMergeQueue={hasMergeQueue}
            currentUserReview={currentUserReview}
            isReRequested={isReRequested}
            panelOpen={panelOpen}
          />
        )}
      </div>
    </div>
  );
}

function CompletedPrBanner({ pr }: { pr: GhPrDetail }) {
  const label = getCompletedPullRequestLabel(pr.state);
  const completedAt = getCompletedPullRequestTimestamp(pr);

  if (!label) {
    return null;
  }

  const description = completedAt
    ? `${label} ${relativeTime(new Date(completedAt))}. Review and merge controls are unavailable for completed pull requests.`
    : `${label}. Review and merge controls are unavailable for completed pull requests.`;

  return (
    <div className="border-border-subtle border-b px-4 py-2">
      <div
        className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
          pr.state === "MERGED"
            ? "border-purple/25 bg-purple-muted text-purple"
            : "border-destructive/25 bg-danger-muted text-destructive"
        }`}
      >
        {pr.state === "MERGED" ? (
          <GitMerge
            size={13}
            className="mt-0.5 shrink-0"
          />
        ) : (
          <XCircle
            size={13}
            className="mt-0.5 shrink-0"
          />
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.01em]">{label} pull request</p>
          <p className="text-text-secondary text-[11px] leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}
