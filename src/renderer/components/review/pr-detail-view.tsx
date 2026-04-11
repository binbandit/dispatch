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
import { ResizeHandle } from "@/renderer/components/shared/resize-handle";
import { useAiSuggestions } from "@/renderer/hooks/ai/use-ai-suggestions";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { isAiEnabledPreference, usePreference } from "@/renderer/hooks/preferences/use-preference";
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
import {
  buildReviewCommentsMap,
  buildReviewThreadStateByRootCommentId,
  type ReviewThreadState,
} from "@/renderer/lib/review/review-comments";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitCommitHorizontal, GitMerge, XCircle } from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CompactPrHeader } from "./compact-pr-header";
import { SidePanelOverlay } from "./side-panel-overlay";

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

const FLOATING_REVIEW_BAR_CLEARANCE = 96;
const PANEL_DEFAULT_WIDTH = 380;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_RATIO = 0.5;
const PANEL_WIDTH_KEY = "dispatch-panel-width";

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
  const { cwd, nwo, repo, repoTarget } = useWorkspace();
  const {
    currentFileIndex,
    currentFilePath: storedCurrentFilePath,
    setCurrentFileIndex,
    setCurrentFilePath,
    selectedCommit,
    setSelectedCommit,
    diffMode,
    setDiffMode,
    panelOpen,
    setPanelOpen,
    panelTab,
    setPanelTab,
  } = useFileNav();
  const defaultDiffView = usePreference("defaultDiffView");
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

  // Resizable side panel
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = sessionStorage.getItem(PANEL_WIDTH_KEY);
    return stored ? Number(stored) : PANEL_DEFAULT_WIDTH;
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const diffAreaRef = useRef<HTMLDivElement>(null);
  const handlePanelResize = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const maxWidth = Math.floor(rect.width * PANEL_MAX_RATIO);
    const newWidth = Math.round(
      Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, rect.right - clientX)),
    );
    setPanelWidth(newWidth);
    sessionStorage.setItem(PANEL_WIDTH_KEY, String(newWidth));
  }, []);
  const handlePanelResetWidth = useCallback(() => {
    setPanelWidth(PANEL_DEFAULT_WIDTH);
    sessionStorage.setItem(PANEL_WIDTH_KEY, String(PANEL_DEFAULT_WIDTH));
  }, []);

  const highlighter = useSyntaxHighlighter();

  // Repo info (for admin permissions)
  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
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
    queryKey: ["pr", "detail", nwo, prNumber],
    queryFn: () => ipc("pr.detail", { ...repoTarget, prNumber }),
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
      repo: nwo,
      prNumber,
      updatedAt: detailQuery.data.updatedAt,
    });
  }, [
    nwo,
    detailQuery.data?.updatedAt,
    detailQuery.isFetchedAfterMount,
    markPrActivitySeenMutation,
    prNumber,
  ]);

  // Full PR diff
  const diffQuery = useQuery({
    queryKey: ["pr", "diff", nwo, prNumber],
    queryFn: () => ipc("pr.diff", { ...repoTarget, prNumber }),
    staleTime: 60_000,
  });

  // Commit-specific diff (only fetched when a commit is selected)
  const commitDiffQuery = useQuery({
    queryKey: ["git", "commitDiff", nwo, selectedCommit?.oid],
    queryFn: () => ipc("git.commitDiff", { cwd: cwd!, sha: selectedCommit!.oid }),
    enabled: Boolean(selectedCommit) && cwd !== null,
    staleTime: 60_000,
  });

  // Review rounds
  const repoName = repo;
  const lastShaQuery = useQuery({
    queryKey: ["review", "getLastSha", nwo, prNumber],
    queryFn: () => ipc("review.getLastSha", { repo: nwo, prNumber }),
  });
  const lastSha = lastShaQuery.data ?? null;
  const headSha = detailQuery.data?.headRefOid ?? "";

  // Incremental diff
  const incrementalDiffQuery = useQuery({
    queryKey: ["git", "diff", nwo, lastSha, headSha],
    queryFn: () => ipc("git.diff", { cwd: cwd!, fromRef: lastSha ?? "", toRef: headSha }),
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
    queryKey: ["pr", "comments", nwo, prNumber],
    queryFn: () => ipc("pr.comments", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  // PR issue comments (general conversation)
  const issueCommentsQuery = useQuery({
    queryKey: ["pr", "issueComments", nwo, prNumber],
    queryFn: () => ipc("pr.issueComments", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  const emptyCommentsMap = useMemo(() => new Map<string, ReviewComment[]>(), []);
  const commentsMap = useMemo(
    () => buildReviewCommentsMap<ReviewComment>(commentsQuery.data ?? []),
    [commentsQuery.data],
  );

  // CI annotations — empty when viewing a commit
  const annotationsQuery = useQuery({
    queryKey: ["checks", "annotations", nwo, prNumber],
    queryFn: () => ipc("checks.annotations", { ...repoTarget, prNumber }),
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
    queryKey: ["pr", "reviewThreads", nwo, prNumber],
    queryFn: () => ipc("pr.reviewThreads", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  // Reactions (PR body + all comments)
  const reactionsQuery = useQuery({
    queryKey: ["pr", "reactions", nwo, prNumber],
    queryFn: () => ipc("pr.reactions", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });

  const aiEnabled = isAiEnabledPreference(usePreference("aiEnabled"));
  const prDetail = detailQuery.data;
  const aiReviewEnabled = aiEnabled && prDetail?.state === "OPEN";
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
    enabled: aiReviewEnabled,
  });

  const resolvedCurrentFileIndex = useMemo(() => {
    if (files.length === 0) {
      return 0;
    }

    if (storedCurrentFilePath !== null) {
      const storedPathIndex = files.findIndex(
        (file) => getDiffFilePath(file) === storedCurrentFilePath,
      );
      if (storedPathIndex !== -1) {
        return storedPathIndex;
      }
    }

    return Math.min(Math.max(currentFileIndex, 0), files.length - 1);
  }, [currentFileIndex, files, storedCurrentFilePath]);

  const currentFile = files[resolvedCurrentFileIndex] ?? null;
  const currentFilePath = currentFile ? getDiffFilePath(currentFile) : null;
  const currentFilePathForAi = currentFilePath ?? "";
  const currentLanguage = inferLanguage(currentFilePathForAi);
  const [isPrimingFullFileView, setIsPrimingFullFileView] = useState(false);
  const setCurrentFileState = useCallback(
    (index: number) => {
      setCurrentFileIndex(index);
      const file = files[index];
      setCurrentFilePath(file ? getDiffFilePath(file) : null);
    },
    [files, setCurrentFileIndex, setCurrentFilePath],
  );

  useEffect(() => {
    const cancelAutoTrigger = currentFilePath ? autoTriggerFile(currentFilePath) : undefined;

    if (files.length === 0) {
      if (currentFileIndex !== 0) {
        setCurrentFileIndex(0);
      }
      if (storedCurrentFilePath !== null) {
        setCurrentFilePath(null);
      }
      return cancelAutoTrigger;
    }

    if (currentFileIndex !== resolvedCurrentFileIndex) {
      setCurrentFileIndex(resolvedCurrentFileIndex);
    }

    if (storedCurrentFilePath !== currentFilePath) {
      setCurrentFilePath(currentFilePath);
    }

    return cancelAutoTrigger;
  }, [
    autoTriggerFile,
    currentFilePath,
    currentFileIndex,
    files.length,
    resolvedCurrentFileIndex,
    setCurrentFileIndex,
    setCurrentFilePath,
    storedCurrentFilePath,
  ]);

  const aiSuggestionsMap = useMemo(() => {
    if (!currentFilePathForAi) {
      return;
    }
    const suggestions = suggestionsForFile(currentFilePathForAi);
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
  }, [currentFilePathForAi, suggestionsForFile]);

  const { codeThemeLight, codeThemeDark } = useTheme();
  const activeFilePath = currentFilePath ?? "";

  // Ensure the language and code theme are loaded (lazy-load non-core langs & themes)
  if (highlighter && currentLanguage !== "text") {
    ensureLanguage(currentLanguage);
  }
  if (highlighter) {
    ensureTheme(codeThemeDark);
    ensureTheme(codeThemeLight);
  }

  // Full file content (for "show full file" mode)
  const fullFileRef = selectedCommit ? selectedCommit.oid : headSha || "HEAD";
  const fullFileQueryKey = ["gh", "fileAtRef", nwo, fullFileRef, activeFilePath] as const;
  const fetchFullFileContent = useCallback(
    () => ipc("gh.fileAtRef", { ...repoTarget, ref: fullFileRef, filePath: activeFilePath }),
    [activeFilePath, fullFileRef, repoTarget],
  );
  const fullFileQuery = useQuery({
    queryKey: fullFileQueryKey,
    queryFn: fetchFullFileContent,
    enabled: showFullFile && Boolean(activeFilePath) && Boolean(fullFileRef),
    staleTime: 120_000,
  });
  const isFullFileContentLoading = showFullFile && fullFileQuery.isLoading;
  const isFullFileLoading = isPrimingFullFileView || isFullFileContentLoading;
  const handleViewModeChange = useCallback(
    async (nextViewMode: DiffMode) => {
      if (nextViewMode !== "full-file" || showFullFile || !activeFilePath || !fullFileRef) {
        setViewMode(nextViewMode);
        return;
      }

      setIsPrimingFullFileView(true);

      try {
        await queryClient.fetchQuery({
          queryKey: fullFileQueryKey,
          queryFn: fetchFullFileContent,
          staleTime: 120_000,
        });
        startTransition(() => {
          setViewMode("full-file");
          setIsPrimingFullFileView(false);
        });
      } catch {
        toastManager.add({ title: "Failed to load full file", type: "error" });
        setIsPrimingFullFileView(false);
      }
    },
    [activeFilePath, fetchFullFileContent, fullFileQueryKey, fullFileRef, showFullFile],
  );

  const togglePanel = useCallback(() => setPanelOpen(!panelOpen), [panelOpen, setPanelOpen]);

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
          setCurrentFileState(fileIndex);
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
    [commentsQuery.data, files, setCurrentFileState],
  );

  // Navigate to a specific thread's file and scroll to the comment line
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);

  const handleThreadClick = useCallback(
    (path: string, line: number | null) => {
      const fileIndex = files.findIndex((f) => getDiffFilePath(f) === path);
      if (fileIndex !== -1) {
        setCurrentFileState(fileIndex);
        setScrollToLine(line);
      }
    },
    [files, setCurrentFileState],
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
    if (isFullFileLoading) {
      return;
    }
    setCurrentFileState(Math.max(0, resolvedCurrentFileIndex - 1));
  }, [isFullFileLoading, resolvedCurrentFileIndex, setCurrentFileState]);
  const goToNextFile = useCallback(() => {
    if (isFullFileLoading) {
      return;
    }
    setCurrentFileState(Math.min(files.length - 1, resolvedCurrentFileIndex + 1));
  }, [files.length, isFullFileLoading, resolvedCurrentFileIndex, setCurrentFileState]);

  // Viewed files (shared query key — React Query dedupes with sidebar)
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", repoName, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: repoName, prNumber }),
  });

  // Toggle viewed state for current file via `v` key
  const handleToggleViewed = useCallback(() => {
    if (!activeFilePath || selectedCommit || prDetail?.state !== "OPEN" || isFullFileLoading) {
      return;
    }
    const isCurrentlyViewed = viewedQuery.data?.includes(activeFilePath) ?? false;
    ipc("review.setFileViewed", {
      repo: repoName,
      prNumber,
      filePath: activeFilePath,
      viewed: !isCurrentlyViewed,
    })
      .then(() => viewedQuery.refetch())
      .catch(() => {
        toastManager.add({ title: "Failed to update viewed state", type: "error" });
      });
  }, [
    activeFilePath,
    isFullFileLoading,
    prDetail?.state,
    prNumber,
    repoName,
    selectedCommit,
    viewedQuery,
  ]);

  // Hunk navigation — jump between diff hunks within the current file
  const navigateDiffElement = useCallback((selector: string, direction: "prev" | "next") => {
    const scrollContainer = diffAreaRef.current?.querySelector("[class*='overflow-auto']");
    if (!scrollContainer) {
      return;
    }
    const elements = [...scrollContainer.querySelectorAll(selector)] as HTMLElement[];
    if (elements.length === 0) {
      return;
    }
    const containerTop = scrollContainer.getBoundingClientRect().top;
    if (direction === "next") {
      for (const el of elements) {
        const elTop = el.getBoundingClientRect().top - containerTop;
        if (elTop > 8) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
      }
    } else {
      for (let i = elements.length - 1; i >= 0; i--) {
        const elTop = elements[i]!.getBoundingClientRect().top - containerTop;
        if (elTop < -8) {
          elements[i]!.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
      }
    }
  }, []);

  // Keyboard shortcuts — centralized via useKeyboardShortcuts
  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    { ...getBinding("navigation.prevFile"), handler: goToPrevFile },
    { ...getBinding("navigation.nextFile"), handler: goToNextFile },
    {
      ...getBinding("navigation.prevHunk"),
      handler: () => navigateDiffElement("[data-hunk]", "prev"),
    },
    {
      ...getBinding("navigation.nextHunk"),
      handler: () => navigateDiffElement("[data-hunk]", "next"),
    },
    {
      ...getBinding("actions.nextComment"),
      handler: () => navigateDiffElement("[data-comment]", "next"),
    },
    {
      ...getBinding("actions.prevComment"),
      handler: () => navigateDiffElement("[data-comment]", "prev"),
    },
    { ...getBinding("actions.togglePanel"), handler: togglePanel },
    {
      ...getBinding("actions.openConversation"),
      handler: () => {
        setPanelTab("conversation");
        setPanelOpen(true);
      },
    },
    {
      ...getBinding("actions.closePanel"),
      handler: () => setPanelOpen(false),
      when: () => panelOpen,
    },
    { ...getBinding("actions.toggleViewed"), handler: handleToggleViewed },
    {
      ...getBinding("actions.nextUnreviewed"),
      handler: () => {
        if (isFullFileLoading) {
          return;
        }
        // Jump to next unviewed file
        const viewed = new Set(viewedQuery.data ?? []);
        for (let i = resolvedCurrentFileIndex + 1; i < files.length; i++) {
          const path = getDiffFilePath(files[i]!);
          if (!viewed.has(path)) {
            setCurrentFileState(i);
            return;
          }
        }
        // Wrap around
        for (let i = 0; i < resolvedCurrentFileIndex; i++) {
          const path = getDiffFilePath(files[i]!);
          if (!viewed.has(path)) {
            setCurrentFileState(i);
            return;
          }
        }
      },
    },
  ]);

  const reviewThreadStateByRootCommentId = useMemo(
    () => buildReviewThreadStateByRootCommentId(reviewThreadsQuery.data ?? []),
    [reviewThreadsQuery.data],
  );
  const emptyReviewThreadStateByRootCommentId = useMemo(
    () => new Map<number, ReviewThreadState>(),
    [],
  );

  // Check if the current user has been re-requested for review (e.g. after new commits)
  const reviewRequestsQuery = useQuery({
    queryKey: ["pr", "reviewRequests", nwo, prNumber],
    queryFn: () => ipc("pr.reviewRequests", { ...repoTarget, prNumber }),
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
  const reviewControlsEnabled = !selectedCommit && !isCompletedPr;
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
        repoTarget={repoTarget}
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
      <div
        ref={splitContainerRef}
        className="relative flex flex-1 overflow-hidden"
      >
        <div
          ref={diffAreaRef}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <DiffToolbar
            currentFile={currentFile}
            currentIndex={resolvedCurrentFileIndex}
            totalFiles={files.length}
            onPrev={goToPrevFile}
            onNext={goToNextFile}
            diffMode={selectedCommit ? "all" : diffMode}
            onDiffModeChange={setDiffMode}
            hasLastReview={!selectedCommit && Boolean(lastSha) && lastSha !== headSha}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            isViewed={
              selectedCommit
                ? false
                : activeFilePath
                  ? (viewedQuery.data?.includes(activeFilePath) ?? false)
                  : false
            }
            onToggleViewed={handleToggleViewed}
            hideReviewControls={!reviewControlsEnabled}
            onAiSuggest={
              aiReviewEnabled && reviewControlsEnabled && activeFilePath
                ? () => generateForFile(activeFilePath)
                : undefined
            }
            isAiSuggesting={activeFilePath ? isAiGenerating(activeFilePath) : false}
            aiSuggestEnabled={aiReviewEnabled}
            isFullFileLoading={isFullFileLoading}
          />

          {isLoadingDiff ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-primary h-4 w-4" />
            </div>
          ) : isFullFileContentLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2">
              <Spinner className="text-accent-text h-4 w-4" />
              <span className="text-text-tertiary text-xs font-medium">Loading full file...</span>
            </div>
          ) : currentFile ? (
            <DiffViewer
              key={`${selectedCommit?.oid ?? headSha ?? "head"}:${activeFilePath}:${viewMode}`}
              file={currentFile}
              highlighter={highlighter}
              language={inferLanguage(getDiffFilePath(currentFile))}
              comments={selectedCommit ? emptyCommentsMap : commentsMap}
              annotations={selectedCommit ? emptyAnnotationsMap : annotationsMap}
              prNumber={prNumber}
              activeComposer={reviewControlsEnabled ? activeComposer : null}
              onCommentRange={reviewControlsEnabled ? setActiveComposer : undefined}
              onCloseComposer={reviewControlsEnabled ? () => setActiveComposer(null) : undefined}
              fullFileContent={showFullFile ? (fullFileQuery.data ?? null) : null}
              diffMode={viewMode}
              reviewThreadStateByRootCommentId={
                selectedCommit
                  ? emptyReviewThreadStateByRootCommentId
                  : reviewThreadStateByRootCommentId
              }
              reviewCommentReactions={
                selectedCommit ? undefined : reactionsQuery.data?.reviewComments
              }
              aiSuggestions={reviewControlsEnabled ? aiSuggestionsMap : undefined}
              reviewActionsEnabled={reviewControlsEnabled}
              bottomOverlayInset={reviewControlsEnabled ? FLOATING_REVIEW_BAR_CLEARANCE : 0}
              onPostSuggestion={reviewControlsEnabled ? postSuggestion : undefined}
              onDismissSuggestion={dismissSuggestion}
              scrollToLine={scrollToLine}
              onScrollToLineComplete={() => setScrollToLine(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-text-tertiary text-xs">No files changed</p>
            </div>
          )}
        </div>

        {/* Resize handle + Side panel */}
        {panelOpen && (
          <ResizeHandle
            onResize={handlePanelResize}
            onDoubleClick={handlePanelResetWidth}
          />
        )}
        <SidePanelOverlay
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          pr={pr}
          prNumber={prNumber}
          issueComments={issueCommentsQuery.data ?? []}
          repo={repoSlug}
          highlightedLogin={highlightedComment?.login ?? null}
          onReviewClick={handleReviewClick}
          onThreadClick={handleThreadClick}
          diffSnippet={rawDiff ?? ""}
          activeTab={panelTab}
          onTabChange={setPanelTab}
          reviewThreads={reviewThreadsQuery.data}
          reactions={reactionsQuery.data}
          canEdit={canPush}
          width={panelWidth}
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
            repoTarget={repoTarget}
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
