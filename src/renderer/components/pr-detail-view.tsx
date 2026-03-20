import type { Annotation } from "./ci-annotation";
import type { ReviewComment } from "./inline-comment";
import type { GhPrDetail } from "@/shared/ipc";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Dices,
  ExternalLink,
  FileCode,
  GitMerge,
  MessageSquare,
  PencilLine,
  Rows2,
  XCircle,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { useSyntaxHighlighter } from "../hooks/use-syntax-highlight";
import { getDiffFilePath, parseDiff, type DiffFile } from "../lib/diff-parser";
import { useFileNav } from "../lib/file-nav-context";
import { ensureLanguage, inferLanguage } from "../lib/highlighter";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { AiReviewSummary } from "./ai-review-summary";
import { ChecksPanel } from "./checks-panel";
import { DiffViewer, type CommentRange, type DiffMode } from "./diff-viewer";
import { GitHubAvatar } from "./github-avatar";
import { PrDetailSkeleton } from "./loading-skeletons";
import { MarkdownBody } from "./markdown-body";
import { MentionTextarea } from "./mention-textarea";

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

// Remember active tab per PR across navigation
const tabMemory = new Map<number, "overview" | "checks" | "reviews">();

function PrDetail({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const { currentFileIndex, setCurrentFileIndex } = useFileNav();
  const [activeTab, setActiveTabRaw] = useState<"overview" | "checks" | "reviews">(
    tabMemory.get(prNumber) ?? "overview",
  );

  // Persist tab choice
  function setActiveTab(tab: "overview" | "checks" | "reviews") {
    tabMemory.set(prNumber, tab);
    setActiveTabRaw(tab);
  }
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

  const saveShaMutation = useMutation({
    mutationFn: (args: { repo: string; prNumber: number; sha: string }) =>
      ipc("review.saveSha", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", "getLastSha"] });
      toastManager.add({ title: "Review SHA saved", type: "success" });
    },
  });

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
          // The diff viewer will show the inline comment automatically
          // since comments are already wired via commentsMap
        }
      } else {
        // No inline comments — switch to overview and highlight the review
        setActiveTab("overview");
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

  // Keyboard shortcuts — centralized via useKeyboardShortcuts
  useKeyboardShortcuts([
    { key: "[", handler: goToPrevFile },
    { key: "]", handler: goToNextFile },
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
  const canEditTitle = isAuthor || canPush;

  // Derive repo "owner/repo" from the PR URL for #123 linkification
  const repoSlug = pr.url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? "";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* PR Header */}
      <div className="border-border bg-bg-surface border-b px-5 py-3">
        {/* Top row: title + metadata */}
        <div className="flex items-start gap-3">
          <GitHubAvatar
            login={pr.author.login}
            size={28}
            className="border-border-strong mt-0.5 border-[1.5px]"
          />
          <div className="min-w-0 flex-1">
            <EditablePrTitle
              canEdit={canEditTitle}
              cwd={cwd}
              prNumber={pr.number}
              title={pr.title}
            />
            <div className="text-text-secondary mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              <Badge
                variant="outline"
                className="border-border bg-bg-raised text-accent-text rounded-sm font-mono text-[11px]"
              >
                {pr.headRefName}
              </Badge>
              <span className="text-text-tertiary">→</span>
              <span className="text-text-tertiary font-mono text-[11px]">{pr.baseRefName}</span>
              <span className="text-text-ghost">·</span>
              <span>{pr.author.login}</span>
              {isAuthor && (
                <Badge
                  variant="outline"
                  className="border-primary/30 text-primary text-[9px]"
                >
                  You
                </Badge>
              )}
              <span className="text-text-ghost">·</span>
              <span>{relativeTime(new Date(pr.updatedAt))}</span>
              <span className="text-text-ghost">·</span>
              <span className="text-success font-mono text-[11px]">+{totalAdditions}</span>
              <span className="text-destructive font-mono text-[11px]">-{totalDeletions}</span>
              {pr.isDraft && (
                <Badge
                  variant="outline"
                  className="border-warning/30 text-warning text-[9px]"
                >
                  Draft
                </Badge>
              )}
            </div>
          </div>
          {/* External link */}
          <Button
            size="sm"
            variant="ghost"
            className="text-text-tertiary hover:text-text-primary shrink-0"
            onClick={() => {
              void openExternal(pr.url);
            }}
          >
            <ExternalLink size={13} />
          </Button>
        </div>

        {/* Action bar: review actions + merge — separate row with breathing room */}
        <div className="mt-2.5 flex items-center gap-2 pl-[40px]">
          {!isAuthor && (
            <>
              <ApproveButton
                cwd={cwd}
                prNumber={prNumber}
                currentUserReview={
                  currentUser
                    ? (pr.reviews
                        .filter((r) => r.author.login === currentUser)
                        .sort(
                          (a, b) =>
                            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
                        )[0]?.state ?? null)
                    : null
                }
              />
              <RequestChangesButton
                cwd={cwd}
                prNumber={prNumber}
              />
              <div className="bg-border mx-0.5 h-4 w-px" />
            </>
          )}
          <MergeButton
            cwd={cwd}
            prNumber={prNumber}
            pr={pr}
            canAdmin={canPush}
          />
        </div>
      </div>

      {/* Diff viewer + side panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Diff content area */}
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
            onMarkReviewed={() => {
              if (headSha) {
                saveShaMutation.mutate({ repo: repoName, prNumber, sha: headSha });
              }
            }}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showFullFile={showFullFile}
            onShowFullFileChange={setShowFullFile}
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

        {/* Side panel (§ 8.7) — 320px */}
        <aside className="border-border bg-bg-surface flex w-[320px] shrink-0 flex-col border-l">
          {/* Tabs */}
          <div className="border-border flex border-b px-3 pt-2.5">
            <TabButton
              label="Overview"
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            />
            <TabButton
              label="Checks"
              count={pr.statusCheckRollup.length}
              active={activeTab === "checks"}
              onClick={() => setActiveTab("checks")}
            />
            <TabButton
              label="Reviews"
              count={pr.reviews.length}
              active={activeTab === "reviews"}
              onClick={() => setActiveTab("reviews")}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "overview" && (
              <OverviewTab
                pr={pr}
                prNumber={prNumber}
                issueComments={issueCommentsQuery.data ?? []}
                repo={repoSlug}
                highlightedLogin={highlightedComment?.login ?? null}
                onReviewClick={handleReviewClick}
              />
            )}
            {activeTab === "checks" && <ChecksPanel prNumber={prNumber} />}
            {activeTab === "reviews" && (
              <ReviewsList
                reviews={pr.reviews}
                onReviewClick={(login) => handleReviewClick(login)}
              />
            )}
          </div>

          {/* Merge checklist */}
          <MergeChecklist pr={pr} />
        </aside>
      </div>
    </div>
  );
}

function EditablePrTitle({
  canEdit,
  cwd,
  prNumber,
  title,
}: {
  canEdit: boolean;
  cwd: string;
  prNumber: number;
  title: string;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setDraftTitle(title);
  }, [isEditing, title]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  const updateTitleMutation = useMutation({
    mutationFn: (nextTitle: string) => ipc("pr.updateTitle", { cwd, prNumber, title: nextTitle }),
    onSuccess: (_data, nextTitle) => {
      const updatedAt = new Date().toISOString();

      queryClient.setQueryData<GhPrDetail | undefined>(["pr", "detail", cwd, prNumber], (old) =>
        old ? { ...old, title: nextTitle, updatedAt } : old,
      );

      setDraftTitle(nextTitle);
      setIsEditing(false);

      void queryClient.invalidateQueries({ queryKey: ["pr", "detail", cwd, prNumber] });
      void queryClient.invalidateQueries({ queryKey: ["pr", "list", cwd] });
      void queryClient.invalidateQueries({ queryKey: ["pr", "listAll"] });

      toastManager.add({ title: "Title updated", type: "success" });
    },
    onError: (error) => {
      toastManager.add({
        title: "Title update failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    },
  });

  const beginEditing = useCallback(() => {
    if (!canEdit || updateTitleMutation.isPending) {
      return;
    }

    setDraftTitle(title);
    setIsEditing(true);
  }, [canEdit, title, updateTitleMutation.isPending]);

  const cancelEditing = useCallback(() => {
    if (updateTitleMutation.isPending) {
      return;
    }

    setDraftTitle(title);
    setIsEditing(false);
  }, [title, updateTitleMutation.isPending]);

  const saveTitle = useCallback(() => {
    if (updateTitleMutation.isPending) {
      return;
    }

    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      toastManager.add({
        title: "Title required",
        description: "Pull request titles cannot be empty.",
        type: "error",
      });
      return;
    }

    if (nextTitle === title) {
      setDraftTitle(title);
      setIsEditing(false);
      return;
    }

    updateTitleMutation.mutate(nextTitle);
  }, [draftTitle, title, updateTitleMutation]);

  if (isEditing) {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="border-border bg-bg-raised focus-within:border-border-strong flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow] duration-[120ms] ease-out focus-within:shadow-[0_0_0_1px_rgba(212,136,58,0.18)]">
            <input
              ref={inputRef}
              type="text"
              value={draftTitle}
              disabled={updateTitleMutation.isPending}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveTitle();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              className="text-text-primary placeholder:text-text-ghost min-w-0 flex-1 bg-transparent text-[16px] leading-[1.3] font-semibold tracking-[-0.02em] outline-none"
              aria-label={`Edit title for pull request #${prNumber}`}
            />
            <span className="text-text-tertiary shrink-0 text-[16px] leading-[1.3] font-normal">
              #{prNumber}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="icon-xs"
              loading={updateTitleMutation.isPending}
              onClick={saveTitle}
              className="bg-primary text-primary-foreground hover:bg-accent-hover shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-glow)]"
              aria-label={`Save title for pull request #${prNumber}`}
              title="Save title"
            >
              <Check size={12} />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={updateTitleMutation.isPending}
              onClick={cancelEditing}
              className="text-text-secondary hover:bg-bg-raised hover:text-text-primary"
              aria-label={`Cancel editing title for pull request #${prNumber}`}
              title="Cancel"
            >
              <X size={12} />
            </Button>
          </div>
        </div>

        <div className="text-text-tertiary flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[10px]">
          <div className="flex items-center gap-1.5">
            <Kbd className="border-border-strong bg-bg-raised text-text-secondary h-5 min-w-5 rounded-sm border px-1.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
              Enter
            </Kbd>
            <span>save</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Kbd className="border-border-strong bg-bg-raised text-text-secondary h-5 min-w-5 rounded-sm border px-1.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
              Esc
            </Kbd>
            <span>cancel</span>
          </div>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <h1 className="text-text-primary text-[16px] leading-[1.3] font-semibold tracking-[-0.02em]">
        {title} <span className="text-text-tertiary font-normal">#{prNumber}</span>
      </h1>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEditing}
      className="group/title focus-visible:ring-primary/30 hover:bg-bg-raised/80 -mx-1 grid max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1 py-0.5 text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-out outline-none focus-visible:ring-2"
      aria-label={`Edit title for pull request #${prNumber}`}
      title="Edit title"
    >
      <span className="text-text-primary min-w-0 text-[16px] leading-[1.3] font-semibold tracking-[-0.02em]">
        {title} <span className="text-text-tertiary font-normal">#{prNumber}</span>
      </span>
      <span className="text-text-ghost border-border/0 bg-bg-raised/0 group-hover/title:border-border-strong group-hover/title:bg-bg-raised/90 group-hover/title:text-accent-text inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-[background-color,border-color,color] duration-[120ms] ease-out">
        <PencilLine size={12} />
        Edit
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — PR body, author info, inline comments
// ---------------------------------------------------------------------------

function OverviewTab({
  pr,
  prNumber,
  issueComments,
  repo,
  highlightedLogin,
  onReviewClick,
}: {
  pr: {
    body: string;
    author: { login: string };
    reviewDecision: string;
    reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
    updatedAt: string;
    url: string;
  };
  prNumber: number;
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>;
  repo: string;
  highlightedLogin: string | null;
  onReviewClick: (login: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0">
      {/* AI review summary */}
      <AiReviewSummary
        prNumber={prNumber}
        prTitle={pr.body ? pr.body.slice(0, 100) : ""}
        prBody={pr.body}
        author={pr.author.login}
        files={[]}
        diffSnippet=""
      />

      {/* PR description */}
      <div className="border-border border-b px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <GitHubAvatar
            login={pr.author.login}
            size={18}
          />
          <span className="text-text-primary text-[11px] font-medium">{pr.author.login}</span>
          <span className="text-text-ghost text-[10px]">authored</span>
        </div>
        <MarkdownBody
          content={pr.body}
          repo={repo}
        />
      </div>

      {/* Review summary — dedupe to latest per user */}
      {pr.reviews.length > 0 && (
        <OverviewReviewSummary
          reviews={pr.reviews}
          highlightedLogin={highlightedLogin}
          onReviewClick={onReviewClick}
        />
      )}

      {/* Conversation — issue comments (general, not inline on code) */}
      {issueComments.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
            Conversation
          </h3>
          <div className="flex flex-col gap-2">
            {issueComments.map((comment) => (
              <div
                key={comment.id}
                className="border-border rounded-md border p-2.5"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <GitHubAvatar
                    login={comment.author.login}
                    size={16}
                  />
                  <span className="text-text-primary text-[11px] font-medium">
                    {comment.author.login}
                  </span>
                  <span className="text-text-ghost ml-auto font-mono text-[10px]">
                    {relativeTime(new Date(comment.createdAt))}
                  </span>
                </div>
                <MarkdownBody
                  content={comment.body}
                  repo={repo}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty conversation state */}
      {issueComments.length === 0 && pr.reviews.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 px-4 py-8">
          <MessageSquare
            size={20}
            className="text-text-ghost"
          />
          <p className="text-text-tertiary text-xs">No conversation yet</p>
        </div>
      )}

      {/* General comment composer */}
      <GeneralCommentComposer prNumber={prNumber} />
    </div>
  );
}

function GeneralCommentComposer({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const [body, setBody] = useState("");
  const [expanded, setExpanded] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  const commentMutation = useMutation({
    mutationFn: (args: { cwd: string; prNumber: number; body: string }) => ipc("pr.comment", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "issueComments"] });
      toastManager.add({ title: "Comment added", type: "success" });
      setBody("");
      setExpanded(false);
    },
    onError: (err: Error) => {
      toastManager.add({
        title: "Comment failed",
        description: err.message,
        type: "error",
      });
    },
  });

  if (!expanded) {
    return (
      <div className="border-border border-t px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            // Scroll the composer into view after it renders
            requestAnimationFrame(() => {
              composerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            });
          }}
          className="border-border bg-bg-root text-text-tertiary hover:border-primary/40 w-full cursor-pointer rounded-md border px-3 py-2 text-left text-xs"
        >
          Leave a comment...
        </button>
      </div>
    );
  }

  const isMac = navigator.platform.includes("Mac");

  return (
    <div
      ref={composerRef}
      className="border-border border-t px-4 py-3"
    >
      <MentionTextarea
        value={body}
        onChange={setBody}
        placeholder="Leave a comment on this PR... (@ to mention, # to reference)"
        rows={3}
        prNumber={prNumber}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            commentMutation.mutate({ cwd, prNumber, body: body.trim() });
          }
          if (e.key === "Escape") {
            setExpanded(false);
            setBody("");
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-text-ghost text-[10px]">{isMac ? "⌘" : "Ctrl"}+Enter to submit</span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setExpanded(false);
              setBody("");
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-accent-hover"
            disabled={!body.trim() || commentMutation.isPending}
            onClick={() => {
              commentMutation.mutate({ cwd, prNumber, body: body.trim() });
            }}
          >
            {commentMutation.isPending ? <Spinner className="h-3 w-3" /> : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OverviewReviewSummary({
  reviews,
  highlightedLogin,
  onReviewClick,
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  highlightedLogin: string | null;
  onReviewClick: (login: string) => void;
}) {
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
  const uniqueReviews = [...latestByUser.values()];

  return (
    <div className="border-border border-b px-4 py-3">
      <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
        Reviews
      </h3>
      <div className="flex flex-col gap-1.5">
        {uniqueReviews.map((review) => {
          const isHighlighted = highlightedLogin === review.author.login;
          return (
            <button
              key={review.author.login}
              type="button"
              onClick={() => onReviewClick(review.author.login)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                isHighlighted ? "bg-primary/10 ring-primary/40 ring-1" : "hover:bg-bg-raised"
              }`}
            >
              <GitHubAvatar
                login={review.author.login}
                size={16}
              />
              <span className="text-text-primary text-[11px] font-medium">
                {review.author.login}
              </span>
              <ReviewStateBadge state={review.state} />
              <span className="text-text-ghost ml-auto font-mono text-[10px]">
                {relativeTime(new Date(review.submittedAt))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReviewStateBadge({ state }: { state: string }) {
  const config =
    state === "APPROVED"
      ? { text: "Approved", color: "border-success/30 text-success" }
      : state === "CHANGES_REQUESTED"
        ? { text: "Changes Requested", color: "border-destructive/30 text-destructive" }
        : state === "COMMENTED"
          ? { text: "Commented", color: "border-border text-text-tertiary" }
          : state === "DISMISSED"
            ? { text: "Dismissed", color: "border-border text-text-ghost" }
            : state === "PENDING"
              ? { text: "Pending", color: "border-warning/30 text-warning" }
              : { text: state, color: "border-border text-text-tertiary" };

  return (
    <Badge
      variant="outline"
      className={`text-[9px] ${config.color}`}
    >
      {config.text}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <h2 className="font-heading text-text-primary text-3xl italic">Select a pull request</h2>
      <p className="text-text-secondary max-w-xs text-center text-[13px]">
        Choose a PR from the sidebar to start reviewing. Use{" "}
        <kbd className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
          j
        </kbd>
        /
        <kbd className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
          k
        </kbd>{" "}
        to navigate.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff toolbar
// ---------------------------------------------------------------------------

function DiffToolbar({
  currentFile,
  currentIndex,
  totalFiles,
  onPrev,
  onNext,
  diffMode,
  onDiffModeChange,
  hasLastReview,
  onMarkReviewed,
  viewMode,
  onViewModeChange,
  showFullFile,
  onShowFullFileChange,
}: {
  currentFile: DiffFile | null;
  currentIndex: number;
  totalFiles: number;
  onPrev: () => void;
  onNext: () => void;
  diffMode: "all" | "since-review";
  onDiffModeChange: (mode: "all" | "since-review") => void;
  hasLastReview: boolean;
  onMarkReviewed: () => void;
  viewMode: DiffMode;
  onViewModeChange: (mode: DiffMode) => void;
  showFullFile: boolean;
  onShowFullFileChange: (show: boolean) => void;
}) {
  const filePath = currentFile ? getDiffFilePath(currentFile) : "";
  const fileName = filePath.split("/").pop() ?? "";
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";

  return (
    <div className="border-border-subtle bg-bg-surface flex h-[38px] shrink-0 items-center gap-2 border-b px-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={currentIndex === 0}
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft size={13} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={currentIndex >= totalFiles - 1}
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight size={13} />
      </button>

      <span className="text-text-tertiary font-mono text-xs">
        {dirPath}
        <span className="text-text-primary font-medium">{fileName}</span>
      </span>

      <div className="flex-1" />

      {hasLastReview && (
        <div className="border-border bg-bg-raised flex items-center rounded-md border p-[2px]">
          <button
            type="button"
            onClick={() => onDiffModeChange("all")}
            className={`cursor-pointer rounded-sm px-2.5 py-1 text-[11px] ${
              diffMode === "all"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            All changes
          </button>
          <button
            type="button"
            onClick={() => onDiffModeChange("since-review")}
            className={`cursor-pointer rounded-sm px-2.5 py-1 text-[11px] ${
              diffMode === "since-review"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            Since last review
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onMarkReviewed}
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary cursor-pointer rounded-md px-2 py-1 text-[11px]"
      >
        Mark reviewed
      </button>

      <div className="bg-border h-4 w-px" />

      {/* View mode toggles */}
      <button
        type="button"
        onClick={() => onViewModeChange(viewMode === "unified" ? "split" : "unified")}
        title={viewMode === "unified" ? "Split view" : "Unified view"}
        className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm transition-colors ${
          viewMode === "split"
            ? "bg-bg-raised text-text-primary"
            : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary"
        }`}
      >
        {viewMode === "unified" ? <Columns2 size={13} /> : <Rows2 size={13} />}
      </button>

      <button
        type="button"
        onClick={() => onShowFullFileChange(!showFullFile)}
        title={showFullFile ? "Show diff only" : "Show full file"}
        className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm transition-colors ${
          showFullFile
            ? "bg-bg-raised text-text-primary"
            : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary"
        }`}
      >
        <FileCode size={13} />
      </button>

      {currentFile && (
        <>
          <span className="text-success font-mono text-[11px]">+{currentFile.additions}</span>
          <span className="text-destructive font-mono text-[11px]">-{currentFile.deletions}</span>
        </>
      )}

      {totalFiles > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="bg-border h-[3px] w-[60px] overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${((currentIndex + 1) / totalFiles) * 100}%` }}
            />
          </div>
          <span className="text-text-tertiary font-mono text-[10px]">
            {currentIndex + 1}/{totalFiles}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel tabs
// ---------------------------------------------------------------------------

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative cursor-pointer px-3 pb-2.5 text-xs ${
        active
          ? "text-text-primary font-medium"
          : "text-text-secondary hover:text-text-primary font-[450]"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="text-text-tertiary ml-1 font-mono text-[10px]">{count}</span>
      )}
      {active && (
        <div className="bg-primary absolute bottom-0 left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px]" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reviews list
// ---------------------------------------------------------------------------

function ReviewsList({
  reviews,
  onReviewClick,
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  onReviewClick: (login: string) => void;
}) {
  if (reviews.length === 0) {
    return <div className="text-text-tertiary px-3 py-4 text-center text-xs">No reviews yet</div>;
  }

  // Dedupe: show only the most recent review per user
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
  const uniqueReviews = [...latestByUser.values()];

  return (
    <div className="flex flex-col gap-1 p-2">
      {uniqueReviews.map((review) => (
        <button
          key={review.author.login}
          type="button"
          onClick={() => onReviewClick(review.author.login)}
          className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
        >
          <GitHubAvatar
            login={review.author.login}
            size={20}
          />
          <div className="min-w-0 flex-1">
            <span className="text-text-primary text-xs font-medium">{review.author.login}</span>
            <span className="text-text-ghost ml-1.5 font-mono text-[10px]">
              {relativeTime(new Date(review.submittedAt))}
            </span>
          </div>
          <ReviewStateBadge state={review.state} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge checklist (§ 8.8)
// ---------------------------------------------------------------------------

function MergeChecklist({
  pr,
}: {
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
}) {
  const hasApproval = pr.reviewDecision === "APPROVED";
  const allChecksPassing =
    pr.statusCheckRollup.length > 0 &&
    pr.statusCheckRollup.every((c) => c.conclusion === "success");
  const noConflicts = pr.mergeable === "MERGEABLE";

  return (
    <div className="border-border bg-bg-raised border-t p-3">
      <div className="flex flex-col gap-1.5">
        <ChecklistItem
          label="Review approved"
          passed={hasApproval}
        />
        <ChecklistItem
          label={pr.statusCheckRollup.length === 0 ? "No CI checks" : "CI checks passing"}
          passed={allChecksPassing}
        />
        <ChecklistItem
          label={pr.mergeable === "CONFLICTING" ? "Merge conflicts" : "No merge conflicts"}
          passed={noConflicts}
        />
      </div>
    </div>
  );
}

function ChecklistItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-[13px] w-[13px] items-center justify-center text-[10px] ${
          passed ? "text-success" : "text-destructive"
        }`}
      >
        {passed ? "✓" : "✕"}
      </span>
      <span className={`text-[11px] ${passed ? "text-text-secondary" : "text-destructive"}`}>
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge button (§ 8.8)
// ---------------------------------------------------------------------------

const STRATEGY_LABELS: Record<string, string> = {
  squash: "Squash & Merge",
  merge: "Merge",
  rebase: "Rebase & Merge",
};

function MergeButton({
  cwd,
  prNumber,
  pr,
  canAdmin,
}: {
  cwd: string;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
  canAdmin: boolean;
}) {
  const [strategy, setStrategy] = useState<"squash" | "merge" | "rebase">("squash");
  const [menuOpen, setMenuOpen] = useState(false);

  // Merge queue status
  const queueQuery = useQuery({
    queryKey: ["pr", "mergeQueueStatus", cwd, prNumber],
    queryFn: () => ipc("pr.mergeQueueStatus", { cwd, prNumber }),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const queueStatus = queueQuery.data;

  const mergeMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      strategy: "merge" | "squash" | "rebase";
      admin?: boolean;
    }) => ipc("pr.merge", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: `PR #${prNumber} merged`,
        description: "Branch deleted.",
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({
        title: "Merge failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => ipc("pr.close", { cwd, prNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: `PR #${prNumber} closed`,
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({
        title: "Close failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const hasApproval = pr.reviewDecision === "APPROVED";
  const allChecksPassing =
    pr.statusCheckRollup.length > 0 &&
    pr.statusCheckRollup.every((c) => c.conclusion === "success");
  const requirementsMet = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";
  const canMerge = requirementsMet || canAdmin;

  // If in merge queue, show queue status instead of merge button
  if (queueStatus?.inQueue) {
    return (
      <div className="flex items-center gap-2">
        <div className="border-info/30 bg-info/5 flex items-center gap-1.5 rounded-md border px-3 py-1.5">
          <GitMerge
            size={13}
            className="text-info"
          />
          <span className="text-info text-xs font-medium">
            In merge queue
            {queueStatus.position !== null && ` · #${queueStatus.position + 1}`}
          </span>
          {queueStatus.estimatedTimeToMerge !== null && (
            <span className="text-text-tertiary text-[10px]">
              ~{Math.ceil(queueStatus.estimatedTimeToMerge / 60)}min
            </span>
          )}
        </div>
        {canAdmin && (
          <Button
            size="sm"
            variant="ghost"
            className="text-warning hover:text-warning gap-1 text-[10px]"
            onClick={() => mergeMutation.mutate({ cwd, prNumber, strategy, admin: true })}
            disabled={mergeMutation.isPending}
          >
            Skip queue
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="flex">
        <Button
          size="sm"
          className={`gap-1.5 rounded-r-none disabled:opacity-50 ${
            requirementsMet
              ? "bg-primary text-primary-foreground hover:bg-accent-hover"
              : canAdmin
                ? "bg-warning/80 text-bg-root hover:bg-warning/90"
                : "bg-primary text-primary-foreground"
          }`}
          disabled={!canMerge || mergeMutation.isPending}
          onClick={() => {
            mergeMutation.mutate({
              cwd,
              prNumber,
              strategy,
              admin: !requirementsMet && canAdmin ? true : undefined,
            });
          }}
        >
          {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={13} />}
          {STRATEGY_LABELS[strategy]}
        </Button>
        <Button
          size="sm"
          className={`rounded-l-none border-l px-1.5 disabled:opacity-50 ${
            requirementsMet
              ? "border-l-primary-foreground/20 bg-primary text-primary-foreground hover:bg-accent-hover"
              : canAdmin
                ? "border-l-bg-root/20 bg-warning/80 text-bg-root hover:bg-warning/90"
                : "border-l-primary-foreground/20 bg-primary text-primary-foreground"
          }`}
          disabled={mergeMutation.isPending || closeMutation.isPending}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <ChevronDown size={12} />
        </Button>
      </div>

      {menuOpen && (
        <div className="border-border bg-bg-elevated absolute top-full right-0 z-20 mt-1 w-48 rounded-md border p-1 shadow-lg">
          {(["squash", "merge", "rebase"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStrategy(s);
                setMenuOpen(false);
              }}
              className={`flex w-full cursor-pointer items-center rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                strategy === s
                  ? "bg-accent-muted text-accent-text"
                  : "text-text-secondary hover:bg-bg-raised hover:text-text-primary"
              }`}
            >
              {STRATEGY_LABELS[s]}
            </button>
          ))}
          <div className="bg-border my-1 h-px" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              closeMutation.mutate();
            }}
            disabled={closeMutation.isPending}
            className="text-destructive hover:bg-destructive/10 flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-xs transition-colors"
          >
            <XCircle size={12} />
            Close pull request
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve button — Dialog modal with optional message + LGTM gif
// ---------------------------------------------------------------------------

const LGTM_GIFS = [
  "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  "https://media.giphy.com/media/3o7TKF1fSIs1R19B8k/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5APm0/giphy.gif",
  "https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif",
  "https://media.giphy.com/media/xT0xeJpnrWC3XWblEk/giphy.gif",
  "https://media.giphy.com/media/26u4lOMA8JKSnL9Uk/giphy.gif",
  "https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif",
  "https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif",
  "https://media.giphy.com/media/l3q2XhfQ8oCkm1Ts4/giphy.gif",
  "https://media.giphy.com/media/3ohzdIuqJoo8QdKlnW/giphy.gif",
];

function ApproveButton({
  cwd,
  prNumber,
  currentUserReview,
}: {
  cwd: string;
  prNumber: number;
  /** The current user's most recent review state, or null if they haven't reviewed */
  currentUserReview: string | null;
}) {
  const [body, setBody] = useState("");
  const alreadyApproved = currentUserReview === "APPROVED";

  const reviewMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => ipc("pr.submitReview", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "PR approved", type: "success" });
      setBody("");
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  function handleQuickApprove() {
    reviewMutation.mutate({ cwd, prNumber, event: "APPROVE" });
  }

  function insertLgtmGif() {
    const gif = LGTM_GIFS[Math.floor(Math.random() * LGTM_GIFS.length)];
    setBody((prev) => {
      const prefix = prev.trim() ? `${prev.trim()}\n\n` : "";
      return `${prefix}![LGTM](${gif})`;
    });
  }

  if (alreadyApproved) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-success/30 text-success gap-1.5 opacity-60"
        disabled
      >
        ✓ Approved
      </Button>
    );
  }

  return (
    <div className="flex">
      {/* Quick approve (no message) */}
      <Button
        size="sm"
        variant="outline"
        className="border-success/30 text-success hover:bg-success-muted gap-1.5 rounded-r-none"
        disabled={reviewMutation.isPending}
        onClick={handleQuickApprove}
      >
        {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓"}
        Approve
      </Button>
      {/* Expand for message — opens Dialog */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setBody("");
          }
        }}
      >
        <DialogTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="border-success/30 text-success hover:bg-success-muted rounded-l-none border-l-0 px-1.5"
              disabled={reviewMutation.isPending}
            />
          }
        >
          <ChevronDown size={11} />
        </DialogTrigger>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve with comment</DialogTitle>
            <DialogDescription>Optionally leave a message with your approval.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="LGTM! Ship it."
              rows={4}
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-success w-full resize-none rounded-md border px-3 py-2.5 text-xs leading-relaxed focus:outline-none"
            />
            <button
              type="button"
              onClick={insertLgtmGif}
              className="text-text-tertiary hover:text-text-primary mt-1.5 flex cursor-pointer items-center gap-1 text-[11px]"
            >
              <Dices size={13} />
              Insert random LGTM gif
            </button>
          </div>
          <DialogFooter variant="bare">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <DialogClose
              render={
                <Button
                  className="bg-success hover:bg-success/90 text-bg-root"
                  disabled={reviewMutation.isPending}
                  onClick={() => {
                    reviewMutation.mutate({
                      cwd,
                      prNumber,
                      event: "APPROVE",
                      body: body.trim() || undefined,
                    });
                  }}
                />
              }
            >
              {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓ Approve"}
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request Changes button — Dialog modal
// ---------------------------------------------------------------------------

function RequestChangesButton({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const [body, setBody] = useState("");

  const reviewMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => ipc("pr.submitReview", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "Changes requested", type: "success" });
      setBody("");
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setBody("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-danger-muted hover:text-destructive gap-1.5"
          />
        }
      >
        <MessageSquare size={13} />
        Request Changes
      </DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            Describe what needs to change before this can be merged.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs to change?"
            rows={4}
            className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-destructive w-full resize-none rounded-md border px-3 py-2.5 text-xs leading-relaxed focus:outline-none"
          />
        </div>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button
                className="bg-destructive hover:bg-destructive/90 text-white"
                disabled={!body.trim() || reviewMutation.isPending}
                onClick={() => {
                  reviewMutation.mutate({
                    cwd,
                    prNumber,
                    event: "REQUEST_CHANGES",
                    body: body.trim(),
                  });
                }}
              />
            }
          >
            {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "Submit"}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
