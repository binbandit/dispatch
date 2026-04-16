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
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { resolveDiffBlameRefs } from "@/renderer/lib/review/blame-refs";
import {
  getCompletedPullRequestLabel,
  getCompletedPullRequestTimestamp,
  isCompletedPullRequest,
} from "@/renderer/lib/review/completed-pr-state";
import { getDiffFilePath, parseDiff, type DiffFile } from "@/renderer/lib/review/diff-parser";
import { useFileNavStore } from "@/renderer/lib/review/file-nav-context";
import { inferLanguage } from "@/renderer/lib/review/highlighter";
import {
  buildReviewCommentsMap,
  buildReviewThreadStateByRootCommentId,
  type ReviewThreadState,
} from "@/renderer/lib/review/review-comments";
import {
  focusReviewTarget,
  getActiveReviewFocusTarget,
  requestReviewDiffSearchFocus,
  focusReviewTargetSoon,
  type ReviewFocusTarget,
} from "@/renderer/lib/review/review-focus-targets";
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
const PANEL_FOCUS_TARGET_BY_TAB: Record<
  "overview" | "conversation" | "commits" | "checks",
  ReviewFocusTarget
> = {
  overview: "panel-overview",
  conversation: "panel-conversation",
  commits: "panel-commits",
  checks: "panel-checks",
};

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
  // Granular store selectors — only re-render when the specific value changes
  const currentFileIndex = useFileNavStore((s) => s.currentFileIndex);
  const storedCurrentFilePath = useFileNavStore((s) => s.currentFilePath);
  const selectedCommit = useFileNavStore((s) => s.selectedCommit);
  const diffMode = useFileNavStore((s) => s.diffMode);
  const panelOpen = useFileNavStore((s) => s.panelOpen);
  const panelTab = useFileNavStore((s) => s.panelTab);
  const setCurrentFileIndex = useFileNavStore((s) => s.setCurrentFileIndex);
  const setCurrentFilePath = useFileNavStore((s) => s.setCurrentFilePath);
  const setSelectedCommit = useFileNavStore((s) => s.setSelectedCommit);
  const setDiffMode = useFileNavStore((s) => s.setDiffMode);
  const setPanelOpen = useFileNavStore((s) => s.setPanelOpen);
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
  const baseRefName = detailQuery.data?.baseRefName ?? null;

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

  const mergeBaseQuery = useQuery({
    queryKey: ["git", "mergeBase", cwd, baseRefName, headSha],
    queryFn: () => {
      if (!cwd) {
        throw new Error("Merge-base requested without a workspace path.");
      }

      if (!baseRefName || !headSha) {
        throw new Error("Merge-base requested without both refs.");
      }

      return ipc("git.mergeBase", { cwd, refA: baseRefName, refB: headSha });
    },
    enabled: !selectedCommit && cwd !== null && Boolean(baseRefName) && Boolean(headSha),
    staleTime: 60_000,
  });

  // Parse diff — commit diff takes priority when selected
  const rawDiff = selectedCommit
    ? commitDiffQuery.data
    : diffMode === "since-review" && incrementalDiffQuery.data
      ? incrementalDiffQuery.data
      : diffQuery.data;

  const isLoadingDiff = selectedCommit ? commitDiffQuery.isLoading : diffQuery.isLoading;
  const blameRefs = resolveDiffBlameRefs({
    diffMode,
    selectedCommit,
    lastReviewedSha: lastSha,
    headSha,
    baseRefName,
    mergeBaseSha: mergeBaseQuery.data ?? null,
  });

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
    isAutoTriggerScheduled,
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

  const activeFilePath = currentFilePath ?? "";

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
        useFileNavStore.getState().setPanelTab("conversation");
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
          el.focus({ preventScroll: true });
          return;
        }
      }
    } else {
      for (let i = elements.length - 1; i >= 0; i--) {
        const elTop = elements[i]!.getBoundingClientRect().top - containerTop;
        if (elTop < -8) {
          elements[i]!.scrollIntoView({ block: "center", behavior: "smooth" });
          elements[i]!.focus({ preventScroll: true });
          return;
        }
      }
    }
  }, []);

  const focusFileSearch = useCallback(() => {
    focusReviewTargetSoon("file-search", { selectText: true });
  }, []);

  const focusFilesTree = useCallback(() => {
    focusReviewTargetSoon("file-tree");
  }, []);

  const focusDiffViewer = useCallback(() => {
    focusReviewTargetSoon("diff-viewer");
  }, []);

  const focusReviewActions = useCallback(() => {
    focusReviewTargetSoon("review-actions", { preferDescendant: true });
  }, []);

  const focusPanelContent = useCallback(
    (nextPanelTab = panelTab) => {
      setPanelOpen(true);
      focusReviewTargetSoon(PANEL_FOCUS_TARGET_BY_TAB[nextPanelTab], { preferDescendant: true });
    },
    [panelTab, setPanelOpen],
  );

  const openPanelTab = useCallback(
    (nextPanelTab: "overview" | "conversation" | "commits" | "checks") => {
      useFileNavStore.getState().setPanelTab(nextPanelTab);
      focusPanelContent(nextPanelTab);
    },
    [focusPanelContent],
  );

  const cycleFocusRegion = useCallback(
    (direction: "next" | "prev") => {
      const targets = ["file-tree", "diff-viewer", PANEL_FOCUS_TARGET_BY_TAB[panelTab]].filter(
        (target, index, allTargets) => allTargets.indexOf(target) === index,
      ) as ReviewFocusTarget[];
      const availableTargets = targets.filter((target) =>
        document.querySelector(`[data-review-focus-target="${target}"]`),
      );
      if (availableTargets.length === 0) {
        return;
      }

      const activeTarget = getActiveReviewFocusTarget();
      const normalizedActiveTarget =
        activeTarget === "file-search"
          ? "file-tree"
          : activeTarget === "diff-search"
            ? "diff-viewer"
            : activeTarget === "panel-search" || activeTarget === "panel-tabs"
              ? PANEL_FOCUS_TARGET_BY_TAB[panelTab]
              : activeTarget;
      const currentIndex = normalizedActiveTarget
        ? availableTargets.indexOf(normalizedActiveTarget)
        : -1;
      const fallbackIndex = direction === "next" ? 0 : availableTargets.length - 1;
      const nextIndex =
        currentIndex === -1
          ? fallbackIndex
          : direction === "next"
            ? (currentIndex + 1) % availableTargets.length
            : (currentIndex - 1 + availableTargets.length) % availableTargets.length;
      const nextTarget = availableTargets[nextIndex];

      if (!nextTarget) {
        return;
      }

      focusReviewTargetSoon(nextTarget, {
        preferDescendant: nextTarget.startsWith("panel-"),
      });
    },
    [panelTab],
  );

  const focusSearchForCurrentRegion = useCallback(() => {
    const activeTarget = getActiveReviewFocusTarget();

    if (activeTarget === "file-search" || activeTarget === "file-tree") {
      focusFileSearch();
      return;
    }

    if (
      (activeTarget === "panel-search" ||
        activeTarget === "panel-tabs" ||
        activeTarget === "panel-conversation" ||
        activeTarget === "panel-commits" ||
        activeTarget === "panel-checks") &&
      focusReviewTarget("panel-search", { selectText: true })
    ) {
      return;
    }

    if (activeTarget === "panel-overview") {
      focusReviewTargetSoon("panel-tabs", { preferDescendant: true });
      return;
    }

    if (focusReviewTarget("diff-search", { selectText: true })) {
      return;
    }

    requestReviewDiffSearchFocus();
  }, [focusFileSearch]);

  const focusNextUnresolvedThread = useCallback(() => {
    const unresolvedThreads = [
      ...document.querySelectorAll<HTMLElement>("[data-review-thread-state='open']"),
    ];
    if (unresolvedThreads.length === 0) {
      return;
    }

    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = unresolvedThreads.findIndex(
      (thread) => thread === activeElement || thread.contains(activeElement),
    );
    const nextThread =
      unresolvedThreads[(currentIndex + 1 + unresolvedThreads.length) % unresolvedThreads.length];
    nextThread?.focus({ preventScroll: true });
    nextThread?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const activateFocusedThreadControl = useCallback(
    (selector: "[data-review-thread-reply]" | "[data-review-thread-resolve]") => {
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeThread = activeElement?.closest<HTMLElement>("[data-review-thread-id]");
      const control =
        activeThread?.querySelector<HTMLButtonElement>(selector) ??
        (activeElement?.matches(selector) ? (activeElement as HTMLButtonElement) : null);
      control?.click();
    },
    [],
  );

  // Keyboard shortcuts — centralized via useKeyboardShortcuts
  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    {
      ...getBinding("search.focusSearch"),
      handler: focusSearchForCurrentRegion,
      preventWhileTyping: true,
    },
    {
      ...getBinding("navigation.nextRegion"),
      handler: () => cycleFocusRegion("next"),
      preventWhileTyping: true,
    },
    {
      ...getBinding("navigation.prevRegion"),
      handler: () => cycleFocusRegion("prev"),
      preventWhileTyping: true,
    },
    { ...getBinding("navigation.prevFile"), handler: goToPrevFile },
    { ...getBinding("navigation.nextFile"), handler: goToNextFile },
    { ...getBinding("navigation.focusFiles"), handler: focusFilesTree },
    { ...getBinding("navigation.focusDiff"), handler: focusDiffViewer },
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
      ...getBinding("actions.togglePanelAlternate"),
      handler: togglePanel,
      preventWhileTyping: true,
    },
    { ...getBinding("actions.focusPanel"), handler: () => focusPanelContent() },
    { ...getBinding("actions.focusReviewBar"), handler: focusReviewActions },
    {
      ...getBinding("actions.nextUnresolvedThread"),
      handler: focusNextUnresolvedThread,
      preventWhileTyping: true,
    },
    {
      ...getBinding("actions.replyToThread"),
      handler: () => activateFocusedThreadControl("[data-review-thread-reply]"),
      preventWhileTyping: true,
    },
    {
      ...getBinding("actions.resolveThread"),
      handler: () => activateFocusedThreadControl("[data-review-thread-resolve]"),
      preventWhileTyping: true,
    },
    {
      ...getBinding("actions.openOverview"),
      handler: () => openPanelTab("overview"),
      preventWhileTyping: true,
    },
    { sequence: ["g", "o"], handler: () => openPanelTab("overview") },
    {
      ...getBinding("actions.openConversation"),
      handler: () => openPanelTab("conversation"),
      preventWhileTyping: true,
    },
    { sequence: ["g", "c"], handler: () => openPanelTab("conversation") },
    {
      ...getBinding("actions.openCommits"),
      handler: () => openPanelTab("commits"),
      preventWhileTyping: true,
    },
    { sequence: ["g", "t"], handler: () => openPanelTab("commits") },
    {
      ...getBinding("actions.openChecks"),
      handler: () => openPanelTab("checks"),
      preventWhileTyping: true,
    },
    { sequence: ["g", "x"], handler: () => openPanelTab("checks") },
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
          className="border-border-subtle focus-within:border-primary/45 flex flex-1 flex-col overflow-hidden rounded-md border transition-[border-color,box-shadow] duration-[120ms] ease-out focus-within:shadow-[0_0_0_1px_rgba(212,136,58,0.18)]"
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
            isAiSuggestPending={activeFilePath ? isAutoTriggerScheduled(activeFilePath) : false}
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
              oldLineBlameRef={blameRefs.oldLineRef}
              newLineBlameRef={blameRefs.newLineRef}
              highlighter={highlighter}
              language={inferLanguage(getDiffFilePath(currentFile))}
              comments={selectedCommit ? emptyCommentsMap : commentsMap}
              annotations={selectedCommit ? emptyAnnotationsMap : annotationsMap}
              prNumber={prNumber}
              currentUserLogin={currentUser}
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
          pr={pr}
          prNumber={prNumber}
          issueComments={issueCommentsQuery.data ?? []}
          repo={repoSlug}
          highlightedLogin={highlightedComment?.login ?? null}
          onReviewClick={handleReviewClick}
          onThreadClick={handleThreadClick}
          diffSnippet={rawDiff ?? ""}
          reviewThreads={reviewThreadsQuery.data}
          reactions={reactionsQuery.data}
          currentUserLogin={currentUser}
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
