import type { DiffFile } from "../lib/diff-parser";
import type { Annotation } from "./ci-annotation";
import type { CommentRange } from "./diff-viewer";
import type { ReviewComment } from "./inline-comment";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitMerge,
  MessageSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSyntaxHighlighter } from "../hooks/use-syntax-highlight";
import { parseDiff } from "../lib/diff-parser";
import { inferLanguage } from "../lib/highlighter";
import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { ChecksPanel } from "./checks-panel";
import { DiffViewer } from "./diff-viewer";
import { FileTree } from "./file-tree";
import { GitHubAvatar } from "./github-avatar";
import { MarkdownBody } from "./markdown-body";

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
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"overview" | "files" | "checks" | "reviews">(
    "overview",
  );
  const [diffMode, setDiffMode] = useState<"all" | "since-review">("all");
  const [activeComposer, setActiveComposer] = useState<CommentRange | null>(null);

  const highlighter = useSyntaxHighlighter();

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

  // Viewed files
  const viewedQuery = useQuery({
    queryKey: ["review", "viewedFiles", repoName, prNumber],
    queryFn: () => ipc("review.viewedFiles", { repo: repoName, prNumber }),
  });
  const viewedFiles = useMemo(() => new Set(viewedQuery.data ?? []), [viewedQuery.data]);

  const setViewedMutation = useMutation({
    mutationFn: (args: { repo: string; prNumber: number; filePath: string; viewed: boolean }) =>
      ipc("review.setFileViewed", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", "viewedFiles"] });
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

  // PR comments
  const commentsQuery = useQuery({
    queryKey: ["pr", "comments", cwd, prNumber],
    queryFn: () => ipc("pr.comments", { cwd, prNumber }),
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

  // File navigation
  const goToPrevFile = useCallback(() => {
    setCurrentFileIndex((i) => Math.max(0, i - 1));
  }, []);
  const goToNextFile = useCallback(() => {
    setCurrentFileIndex((i) => Math.min(files.length - 1, i + 1));
  }, [files.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (e.key === "[") {
        goToPrevFile();
      } else if (e.key === "]") {
        goToNextFile();
      }
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [goToPrevFile, goToNextFile]);

  // Loading
  if (detailQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* PR Header (§ 8.5) */}
      <div className="border-border bg-bg-surface flex items-center gap-3 border-b px-5 py-3">
        {/* Author avatar */}
        <GitHubAvatar
          login={pr.author.login}
          size={28}
          className="border-border-strong border-[1.5px]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-text-primary text-base font-semibold tracking-[-0.02em]">
            {pr.title} <span className="text-text-tertiary font-normal">#{pr.number}</span>
          </h1>
          <div className="text-text-secondary mt-0.5 flex items-center gap-1.5 text-xs">
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
        <div className="flex items-center gap-1.5">
          {/* Open on GitHub */}
          <Button
            size="sm"
            variant="ghost"
            className="text-text-tertiary hover:text-text-primary gap-1"
            onClick={() => globalThis.open(pr.url, "_blank")}
          >
            <ExternalLink size={13} />
          </Button>

          {/* Review actions — only for reviewers, not the author */}
          {!isAuthor && (
            <>
              <ApproveButton
                cwd={cwd}
                prNumber={prNumber}
              />
              <RequestChangesButton
                cwd={cwd}
                prNumber={prNumber}
              />
            </>
          )}
          <MergeButton
            cwd={cwd}
            prNumber={prNumber}
            pr={pr}
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
          />

          {diffQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-primary h-4 w-4" />
            </div>
          ) : currentFile ? (
            <DiffViewer
              file={currentFile}
              highlighter={highlighter}
              language={inferLanguage(currentFile.newPath || currentFile.oldPath)}
              comments={commentsMap}
              annotations={annotationsMap}
              prNumber={prNumber}
              activeComposer={activeComposer}
              onCommentRange={setActiveComposer}
              onCloseComposer={() => setActiveComposer(null)}
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
              label="Files"
              count={files.length}
              active={activeTab === "files"}
              onClick={() => setActiveTab("files")}
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
                comments={commentsQuery.data ?? []}
                isAuthor={isAuthor}
              />
            )}
            {activeTab === "files" && (
              <div className="p-2">
                <FileTree
                  files={files}
                  currentFileIndex={currentFileIndex}
                  onSelectFile={setCurrentFileIndex}
                  viewedFiles={viewedFiles}
                  onToggleViewed={(filePath, viewed) => {
                    setViewedMutation.mutate({
                      repo: repoName,
                      prNumber,
                      filePath,
                      viewed,
                    });
                  }}
                />
              </div>
            )}
            {activeTab === "checks" && <ChecksPanel prNumber={prNumber} />}
            {activeTab === "reviews" && <ReviewsList reviews={pr.reviews} />}
          </div>

          {/* Merge checklist */}
          <MergeChecklist pr={pr} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — PR body, author info, inline comments
// ---------------------------------------------------------------------------

function OverviewTab({
  pr,
  comments,
  isAuthor,
}: {
  pr: {
    body: string;
    author: { login: string };
    reviewDecision: string;
    reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
    updatedAt: string;
    url: string;
  };
  comments: Array<{ id: number; body: string; user: { login: string }; created_at: string }>;
  isAuthor: boolean;
}) {
  // General (non-inline) comments — those without a path/line
  const generalComments = comments.filter((c) => !("path" in c) || !(c as { line?: unknown }).line);

  return (
    <div className="flex flex-col gap-0">
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
        <MarkdownBody content={pr.body} />
      </div>

      {/* Review summary */}
      {pr.reviews.length > 0 && (
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
            Reviews
          </h3>
          <div className="flex flex-col gap-1.5">
            {pr.reviews.map((review, i) => (
              <div
                key={`${review.author.login}-${review.submittedAt}-${i}`}
                className="flex items-center gap-2"
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Author-specific: ship status summary */}
      {isAuthor && (
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
            Ship status
          </h3>
          <p className="text-text-secondary text-xs">
            {pr.reviewDecision === "APPROVED"
              ? "Your PR has been approved. Ready to merge when CI passes."
              : pr.reviewDecision === "CHANGES_REQUESTED"
                ? "Changes have been requested. Address feedback and push."
                : pr.reviewDecision === "REVIEW_REQUIRED"
                  ? "Waiting for review. Reviewers have been notified."
                  : "No review decision yet."}
          </p>
        </div>
      )}

      {/* Conversation — general comments (not inline) */}
      {generalComments.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
            Conversation
          </h3>
          <div className="flex flex-col gap-2">
            {generalComments.map((comment) => (
              <div
                key={comment.id}
                className="border-border rounded-md border p-2.5"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <GitHubAvatar
                    login={comment.user.login}
                    size={16}
                  />
                  <span className="text-text-primary text-[11px] font-medium">
                    {comment.user.login}
                  </span>
                  <span className="text-text-ghost ml-auto font-mono text-[10px]">
                    {relativeTime(new Date(comment.created_at))}
                  </span>
                </div>
                <p className="text-text-secondary text-xs leading-relaxed whitespace-pre-wrap">
                  {comment.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty conversation state */}
      {generalComments.length === 0 && pr.reviews.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 px-4 py-8">
          <MessageSquare
            size={20}
            className="text-text-ghost"
          />
          <p className="text-text-tertiary text-xs">No conversation yet</p>
        </div>
      )}
    </div>
  );
}

function ReviewStateBadge({ state }: { state: string }) {
  const config =
    state === "APPROVED"
      ? { text: "Approved", color: "border-success/30 text-success" }
      : state === "CHANGES_REQUESTED"
        ? { text: "Changes", color: "border-destructive/30 text-destructive" }
        : state === "COMMENTED"
          ? { text: "Commented", color: "border-border text-text-tertiary" }
          : state === "DISMISSED"
            ? { text: "Dismissed", color: "border-border text-text-ghost" }
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
}) {
  const filePath = currentFile?.newPath ?? currentFile?.oldPath ?? "";
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
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
}) {
  if (reviews.length === 0) {
    return <div className="text-text-tertiary px-3 py-4 text-center text-xs">No reviews yet</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {reviews.map((review, i) => (
        <div
          key={`${review.author.login}-${review.submittedAt}-${i}`}
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
        >
          <GitHubAvatar
            login={review.author.login}
            size={20}
          />
          <div className="min-w-0 flex-1">
            <span className="text-text-primary text-xs font-medium">{review.author.login}</span>
          </div>
          <ReviewStateBadge state={review.state} />
        </div>
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
}: {
  cwd: string;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
}) {
  const [strategy, setStrategy] = useState<"squash" | "merge" | "rebase">("squash");
  const [menuOpen, setMenuOpen] = useState(false);

  const mergeMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      strategy: "merge" | "squash" | "rebase";
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

  const hasApproval = pr.reviewDecision === "APPROVED";
  const allChecksPassing =
    pr.statusCheckRollup.length > 0 &&
    pr.statusCheckRollup.every((c) => c.conclusion === "success");
  const canMerge = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";

  return (
    <div className="relative flex">
      <Button
        size="sm"
        className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1.5 rounded-r-none disabled:opacity-50"
        disabled={!canMerge || mergeMutation.isPending}
        onClick={() => {
          mergeMutation.mutate({ cwd, prNumber, strategy });
        }}
      >
        {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={13} />}
        {STRATEGY_LABELS[strategy]}
      </Button>
      <Button
        size="sm"
        className="border-l-primary-foreground/20 bg-primary text-primary-foreground hover:bg-accent-hover rounded-l-none border-l px-1.5 disabled:opacity-50"
        disabled={!canMerge || mergeMutation.isPending}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <ChevronDown size={12} />
      </Button>
      {menuOpen && (
        <div className="border-border bg-bg-elevated absolute top-full right-0 z-20 mt-1 rounded-md border p-1 shadow-lg">
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
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve button
// ---------------------------------------------------------------------------

function ApproveButton({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const reviewMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => ipc("pr.submitReview", args),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      const desc = variables.event === "APPROVE" ? "You approved this PR." : "Review submitted.";
      toastManager.add({ title: "Review submitted", description: desc, type: "success" });
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
    <Button
      size="sm"
      variant="outline"
      className="border-success/30 text-success hover:bg-success-muted gap-1.5"
      disabled={reviewMutation.isPending}
      onClick={() => {
        reviewMutation.mutate({ cwd, prNumber, event: "APPROVE" });
      }}
    >
      {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓"}
      Approve
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Request Changes button
// ---------------------------------------------------------------------------

function RequestChangesButton({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
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
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:bg-danger-muted hover:text-destructive gap-1.5"
        onClick={() => setOpen(!open)}
      >
        <MessageSquare size={13} />
        Request Changes
      </Button>
      {open && (
        <div className="border-border bg-bg-elevated absolute top-full right-0 z-20 mt-1 w-72 rounded-md border p-3 shadow-lg">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs to change?"
            rows={3}
            className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-full resize-none rounded-md border px-3 py-2 text-xs focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
                e.preventDefault();
                reviewMutation.mutate({
                  cwd,
                  prNumber,
                  event: "REQUEST_CHANGES",
                  body: body.trim(),
                });
              }
              if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setBody("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
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
            >
              {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "Submit"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
