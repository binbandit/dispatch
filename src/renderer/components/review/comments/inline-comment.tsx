import type { ReviewThreadState } from "@/renderer/lib/review/review-comments";
/* eslint-disable import/max-dependencies -- Inline comments are the integration point for reactions, editing, markdown, and review actions in one row component. */
import type { GhReactionGroup } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ReactionBar } from "@/renderer/components/review/comments/reaction-bar";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { useBotSettings } from "@/renderer/hooks/preferences/use-bot-settings";
import { useMinimizedComments } from "@/renderer/hooks/review/use-minimized-comments";
import { useSyntaxHighlighter } from "@/renderer/hooks/review/use-syntax-highlight";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useTheme } from "@/renderer/lib/app/theme-context";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  getShikiTokenColor,
  inferLanguage,
  type ShikiToken,
} from "@/renderer/lib/review/highlighter";
import { relativeTime } from "@/shared/format";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  MessageSquare,
  Reply,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Inline comment display — renders PR review comments in the diff.
 *
 * Features:
 * - Thread grouping (root + replies)
 * - Collapsible threads (fold long conversations)
 * - Reply to thread
 * - Bot comment collapsing
 * - Suggestion block rendering
 * - Thread resolution
 * - Right-click context menu (copy link, reply, copy text)
 */

export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: "LEFT" | "RIGHT";
  user: { login: string; avatar_url?: string };
  created_at: string;
  in_reply_to_id?: number;
  node_id?: string;
}

interface InlineCommentProps {
  comments: ReviewComment[];
  prNumber?: number;
  repo?: string;
  reviewActionsEnabled?: boolean;
  /** Thread metadata keyed by root review comment databaseId */
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
  /** Reaction data for review comments, keyed by databaseId (as string) */
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
}

export function InlineComment({
  comments,
  prNumber,
  repo,
  reviewActionsEnabled = true,
  reviewThreadStateByRootCommentId,
  reviewCommentReactions,
}: InlineCommentProps) {
  const { nwo } = useWorkspace();
  const { isBot, shouldAutoCollapseBot } = useBotSettings();
  const repoKey = repo || nwo;
  const { isCommentMinimized, toggleMinimized } = useMinimizedComments(repoKey, prNumber ?? 0);

  const roots = comments.filter((c) => !c.in_reply_to_id);
  const replies = comments.filter((c) => Boolean(c.in_reply_to_id));
  const rootIds = new Set(roots.map((comment) => comment.id));
  const orphanReplies = replies.filter((comment) => !rootIds.has(comment.in_reply_to_id ?? -1));

  const botRoots = roots.filter((c) => isBot(c.user.login));
  const humanRoots = roots.filter((c) => !isBot(c.user.login));
  const orphanBotReplies = orphanReplies.filter((comment) => isBot(comment.user.login));
  const orphanHumanReplies = orphanReplies.filter((comment) => !isBot(comment.user.login));
  const humanEntries = [...humanRoots, ...orphanHumanReplies];
  const botEntries = [...botRoots, ...orphanBotReplies];

  return (
    <div className="border-border mx-4 my-3 max-w-[52rem] overflow-hidden rounded-[10px] border bg-[linear-gradient(180deg,rgba(15,15,18,0.98),rgba(10,10,12,0.94))] shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
      {humanEntries.map((root, i) => {
        const threadReplies = replies.filter((r) => r.in_reply_to_id === root.id);
        return (
          <CommentThread
            key={root.id}
            root={root}
            replies={threadReplies}
            prNumber={prNumber}
            reviewActionsEnabled={reviewActionsEnabled}
            showBorder={i > 0}
            toggleMinimized={toggleMinimized}
            reviewThreadStateByRootCommentId={reviewThreadStateByRootCommentId}
            isBot={isBot}
            shouldAutoCollapseBot={shouldAutoCollapseBot}
            isCommentMinimized={isCommentMinimized}
            reviewCommentReactions={reviewCommentReactions}
          />
        );
      })}

      {botEntries.length > 0 && (
        <>
          {humanEntries.length > 0 && <div className="border-border border-t" />}
          <BotCommentGroup
            key={botEntries
              .map(
                (comment) => `${comment.user.login}:${shouldAutoCollapseBot(comment.user.login)}`,
              )
              .join("|")}
            comments={botEntries}
            toggleMinimized={toggleMinimized}
            isBot={isBot}
            shouldAutoCollapseBot={shouldAutoCollapseBot}
            isCommentMinimized={isCommentMinimized}
            reviewCommentReactions={reviewCommentReactions}
          />
        </>
      )}
    </div>
  );
}

function InlineMetaBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Comment thread (root + replies, collapsible, with reply input)
// ---------------------------------------------------------------------------

function CommentThread({
  root,
  replies,
  prNumber,
  reviewActionsEnabled,
  showBorder,
  toggleMinimized,
  reviewThreadStateByRootCommentId,
  isBot,
  shouldAutoCollapseBot,
  isCommentMinimized,
  reviewCommentReactions,
}: {
  root: ReviewComment;
  replies: ReviewComment[];
  prNumber?: number;
  reviewActionsEnabled: boolean;
  showBorder: boolean;
  toggleMinimized: (commentId: string, autoMinimized?: boolean) => void;
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
  isBot: (login: string) => boolean;
  shouldAutoCollapseBot: (login: string) => boolean;
  isCommentMinimized: (commentId: string, autoMinimized?: boolean) => boolean;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
}) {
  const threadState = reviewThreadStateByRootCommentId?.get(root.id);
  const isResolvedThread = threadState?.isResolved ?? false;
  const isOutdatedThread = threadState?.isOutdated ?? false;
  const isDismissed = isResolvedThread || isOutdatedThread;
  const hasReplies = replies.length > 0;
  const [collapsed, setCollapsed] = useState(() => isDismissed && hasReplies);
  const [showReply, setShowReply] = useState(false);
  const totalCount = 1 + replies.length;
  const canMutateThread = reviewActionsEnabled && Boolean(prNumber);
  const preview = useMemo(() => buildCommentPreview(root.body, 160), [root.body]);
  const rootAutoMinimized =
    shouldAutoCollapseBot(root.user.login) || (isDismissed && !hasReplies);

  return (
    <div
      className={cn(
        "relative",
        showBorder && "border-border-subtle border-t",
        isResolvedThread &&
          "bg-bg-root/30 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[rgba(61,214,140,0.35)]",
        isOutdatedThread &&
          !isResolvedThread &&
          "bg-bg-root/30 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[rgba(94,89,84,0.35)]",
      )}
    >
      {hasReplies &&
        (collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="hover:bg-bg-raised/40 flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left transition-colors"
          >
            <ChevronRight
              size={12}
              className="text-text-ghost mt-0.5 shrink-0"
            />
            <GitHubAvatar
              login={root.user.login}
              size={16}
              avatarUrl={root.user.avatar_url}
              className="ring-1 ring-[rgba(240,236,230,0.08)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-text-primary truncate text-[11px] font-medium">
                  {root.user.login}
                </span>
                <span className="text-text-tertiary font-mono text-[10px]">
                  {relativeTime(new Date(root.created_at))}
                </span>
                <InlineMetaBadge className="border-border-subtle bg-bg-root/70 text-text-tertiary">
                  +{replies.length} {replies.length === 1 ? "reply" : "replies"}
                </InlineMetaBadge>
                {isResolvedThread && (
                  <InlineMetaBadge className="text-success border-[rgba(61,214,140,0.22)] bg-[rgba(61,214,140,0.08)]">
                    Resolved
                  </InlineMetaBadge>
                )}
                {isOutdatedThread && !isResolvedThread && (
                  <InlineMetaBadge className="text-text-tertiary border-border-subtle bg-bg-root/70">
                    Outdated
                  </InlineMetaBadge>
                )}
              </div>
              <p className="text-text-secondary mt-1 text-[12px] leading-[1.45]">{preview}</p>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="border-border-subtle text-text-tertiary hover:bg-bg-raised/30 hover:text-text-primary flex w-full cursor-pointer items-center gap-1.5 border-b px-3 py-2 text-left text-[10px] transition-colors"
          >
            <ChevronDown
              size={11}
              className="shrink-0"
            />
            <span className="font-mono tracking-[0.08em] uppercase">Thread</span>
            <span className="text-text-ghost">{totalCount} comments</span>
            {isResolvedThread && (
              <InlineMetaBadge className="text-success ml-auto border-[rgba(61,214,140,0.22)] bg-[rgba(61,214,140,0.08)]">
                Resolved
              </InlineMetaBadge>
            )}
            {isOutdatedThread && !isResolvedThread && (
              <InlineMetaBadge className="text-text-tertiary border-border-subtle bg-bg-root/70 ml-auto">
                Outdated
              </InlineMetaBadge>
            )}
          </button>
        ))}

      {!collapsed && (
        <div className={cn(isDismissed && "opacity-60")}>
          <CommentBody
            comment={root}
            isRoot
            onReply={canMutateThread ? () => setShowReply(true) : undefined}
            prNumber={prNumber}
            minimized={isCommentMinimized(String(root.id), rootAutoMinimized)}
            onToggleMinimized={() => toggleMinimized(String(root.id), rootAutoMinimized)}
            reviewThreadState={threadState}
            reviewActionsEnabled={reviewActionsEnabled}
            isBot={isBot}
            reactions={reviewCommentReactions?.[String(root.id)]}
          />
          {replies.map((reply) => (
            <div
              key={reply.id}
              className="border-border-subtle border-t"
            >
              <CommentBody
                comment={reply}
                onReply={canMutateThread ? () => setShowReply(true) : undefined}
                prNumber={prNumber}
                minimized={isCommentMinimized(
                  String(reply.id),
                  shouldAutoCollapseBot(reply.user.login),
                )}
                onToggleMinimized={() =>
                  toggleMinimized(String(reply.id), shouldAutoCollapseBot(reply.user.login))
                }
                reviewActionsEnabled={reviewActionsEnabled}
                isBot={isBot}
                reactions={reviewCommentReactions?.[String(reply.id)]}
              />
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReply && canMutateThread && prNumber && (
        <div className="border-border-subtle border-t">
          <ReplyComposer
            prNumber={prNumber}
            commentId={root.id}
            onClose={() => setShowReply(false)}
          />
        </div>
      )}

      {/* Quick reply button (when not already replying) */}
      {!showReply && !collapsed && canMutateThread && (
        <div
          className={cn(
            "border-border-subtle flex items-center justify-between gap-2 border-t px-3 py-2.5",
            isDismissed && "opacity-50",
          )}
        >
          <span className="text-text-ghost font-mono text-[10px]">
            {totalCount} {totalCount === 1 ? "message" : "messages"}
          </span>
          <button
            type="button"
            onClick={() => setShowReply(true)}
            className="border-border-subtle bg-bg-root/60 text-text-tertiary hover:border-border hover:bg-bg-raised hover:text-text-primary inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors"
          >
            <Reply size={11} />
            Reply to thread
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reply composer
// ---------------------------------------------------------------------------

function ReplyComposer({
  prNumber,
  commentId,
  onClose,
}: {
  prNumber: number;
  commentId: number;
  onClose: () => void;
}) {
  const { repoTarget } = useWorkspace();
  const [body, setBody] = useState("");
  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  const replyMutation = useMutation({
    mutationFn: (args: { body: string }) =>
      ipc("pr.replyToComment", { ...repoTarget, prNumber, commentId, ...args }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      toastManager.add({ title: "Reply added", type: "success" });
      setBody("");
      onClose();
    },
    onError: (err: Error) => {
      toastManager.add({ title: "Reply failed", description: err.message, type: "error" });
    },
  });

  return (
    <div className="bg-bg-root/70 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <InlineMetaBadge className="border-[var(--border-accent)] bg-[var(--accent-muted)] text-[var(--accent-text)]">
          Reply
        </InlineMetaBadge>
        <span className="text-text-tertiary text-[10px]">
          Add context to the current review thread.
        </span>
      </div>
      <ReviewMarkdownComposer
        autoFocus
        compact
        className="border-border-subtle bg-[linear-gradient(180deg,rgba(15,15,18,0.98),rgba(10,10,12,0.88))] shadow-none"
        onChange={setBody}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            replyMutation.mutate({ body: body.trim() });
          }
          if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder="Write a reply..."
        prNumber={prNumber}
        rows={3}
        value={body}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-text-ghost font-mono text-[10px]">{modKey}+Enter to reply</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="text-[11px]"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-accent-hover text-[11px]"
          disabled={!body.trim() || replyMutation.isPending}
          onClick={() => replyMutation.mutate({ body: body.trim() })}
        >
          {replyMutation.isPending ? <Spinner className="h-3 w-3" /> : "Reply"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot comment group — collapsed by default
// ---------------------------------------------------------------------------

function BotCommentGroup({
  comments,
  toggleMinimized,
  isBot,
  shouldAutoCollapseBot,
  isCommentMinimized,
  reviewCommentReactions,
}: {
  comments: ReviewComment[];
  toggleMinimized: (commentId: string, autoMinimized?: boolean) => void;
  isBot: (login: string) => boolean;
  shouldAutoCollapseBot: (login: string) => boolean;
  isCommentMinimized: (commentId: string, autoMinimized?: boolean) => boolean;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
}) {
  const allCommentsAutoCollapsed = comments.every((comment) =>
    shouldAutoCollapseBot(comment.user.login),
  );
  const [expanded, setExpanded] = useState(() => !allCommentsAutoCollapsed);
  const botNames = [...new Set(comments.map((c) => c.user.login))];

  return (
    <div className="border-border-subtle border-t bg-[linear-gradient(180deg,rgba(212,136,58,0.09),rgba(212,136,58,0.03))]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-[11px] transition-colors hover:bg-[rgba(212,136,58,0.04)]"
      >
        <span className="bg-accent-muted border-border-accent text-accent-text flex h-5 w-5 shrink-0 items-center justify-center rounded-full border">
          <Sparkles size={10} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-accent-text text-[11px] font-medium">AI review</span>
            <InlineMetaBadge className="border-[var(--border-accent)] bg-[var(--accent-muted)] text-[var(--accent-text)]">
              Bot
            </InlineMetaBadge>
            <span className="text-text-tertiary truncate text-[10px]">{botNames.join(", ")}</span>
          </div>
          <p className="text-text-ghost mt-0.5 text-[10px]">
            {comments.length} inline {comments.length === 1 ? "comment" : "comments"}
            {allCommentsAutoCollapsed ? " · auto-collapsed" : ""}
          </p>
        </div>
        <span className="ml-auto shrink-0">
          {expanded ? (
            <ChevronDown
              size={11}
              className="text-text-ghost"
            />
          ) : (
            <ChevronRight
              size={11}
              className="text-text-ghost"
            />
          )}
        </span>
      </button>
      {expanded &&
        comments.map((comment) => (
          <div
            key={comment.id}
            className="border-border-subtle border-t"
          >
            <CommentBody
              comment={comment}
              minimized={isCommentMinimized(
                String(comment.id),
                shouldAutoCollapseBot(comment.user.login),
              )}
              onToggleMinimized={() =>
                toggleMinimized(String(comment.id), shouldAutoCollapseBot(comment.user.login))
              }
              isBot={isBot}
              reactions={reviewCommentReactions?.[String(comment.id)]}
            />
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread resolution
// ---------------------------------------------------------------------------

function ThreadResolveButton({
  threadId,
  initialResolved = false,
}: {
  threadId: string;
  initialResolved?: boolean;
}) {
  const { repoTarget } = useWorkspace();
  const [resolved, setResolved] = useState(initialResolved);

  const resolveMutation = useMutation({
    mutationFn: () =>
      resolved
        ? ipc("pr.unresolveThread", { ...repoTarget, threadId })
        : ipc("pr.resolveThread", { ...repoTarget, threadId }),
    onSuccess: () => {
      setResolved((currentResolved) => !currentResolved);
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["pr", "reviewThreads"] });
    },
    onError: () => {
      toastManager.add({ title: "Failed to update thread", type: "error" });
    },
  });

  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(
        "h-6 gap-1 rounded-md border px-2 font-mono text-[10px] shadow-none",
        resolved
          ? "text-success border-[rgba(61,214,140,0.22)] bg-[rgba(61,214,140,0.08)] hover:bg-[rgba(61,214,140,0.12)]"
          : "border-border-subtle bg-bg-root/60 text-text-tertiary hover:border-border hover:bg-bg-raised hover:text-text-primary",
      )}
      onClick={() => resolveMutation.mutate()}
      disabled={resolveMutation.isPending}
    >
      {resolveMutation.isPending ? (
        <Spinner className="h-3 w-3" />
      ) : resolved ? (
        <CheckCircle2
          size={11}
          className="text-success"
        />
      ) : (
        <Circle size={11} />
      )}
      {resolved ? "Resolved" : "Resolve"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function CommentContextMenu({
  comment,
  position,
  onClose,
  onReply,
  prNumber,
}: {
  comment: ReviewComment;
  position: { x: number; y: number };
  onClose: () => void;
  onReply?: () => void;
  prNumber?: number;
}) {
  const { nwo } = useWorkspace();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  // Register global listeners for click-outside and Escape
  useEffect(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClick, handleEscape]);

  return (
    <div
      ref={menuRef}
      className="border-border bg-bg-elevated fixed z-50 rounded-md border p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {onReply && (
        <ContextMenuItem
          icon={<Reply size={12} />}
          label="Reply"
          onClick={() => {
            onReply();
            onClose();
          }}
        />
      )}
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy text"
        onClick={() => {
          navigator.clipboard.writeText(comment.body);
          toastManager.add({ title: "Copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy link"
        onClick={() => {
          const repoSlug = nwo;
          const url = prNumber
            ? `https://github.com/${repoSlug}/pull/${prNumber}#discussion_r${comment.id}`
            : `https://github.com/${repoSlug}#discussion_r${comment.id}`;
          navigator.clipboard.writeText(url);
          toastManager.add({ title: "Link copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<ExternalLink size={12} />}
        label="Open in browser"
        onClick={() => {
          const repoSlug = nwo;
          const url = prNumber
            ? `https://github.com/${repoSlug}/pull/${prNumber}#discussion_r${comment.id}`
            : `https://github.com/${repoSlug}#discussion_r${comment.id}`;
          void openExternal(url);
          onClose();
        }}
      />
      <div style={{ height: "1px", background: "var(--border)", margin: "2px 0" }} />
      <ContextMenuItem
        icon={<MessageSquare size={12} />}
        label="Quote reply"
        onClick={() => {
          const quoted = comment.body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
          navigator.clipboard.writeText(`${quoted}\n\n`);
          toastManager.add({ title: "Quote copied", type: "success" });
          onClose();
        }}
      />
    </div>
  );
}

function ContextMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs"
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Single comment body with context menu
// ---------------------------------------------------------------------------

function CommentBody({
  comment,
  isRoot,
  onReply,
  prNumber,
  minimized,
  onToggleMinimized,
  reviewThreadState,
  reviewActionsEnabled = true,
  isBot,
  reactions,
}: {
  comment: ReviewComment;
  isRoot?: boolean;
  onReply?: () => void;
  prNumber?: number;
  minimized: boolean;
  onToggleMinimized: () => void;
  reviewThreadState?: ReviewThreadState;
  reviewActionsEnabled?: boolean;
  isBot: (login: string) => boolean;
  reactions?: GhReactionGroup[];
}) {
  const isBotUser = isBot(comment.user.login);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { bodyParts, suggestions } = useMemo(() => parseSuggestions(comment.body), [comment.body]);

  // Parse severity from bot comments (look for [Critical], [Suggestion], [Nitpick] patterns)
  const severity = isBotUser ? parseSeverity(comment.body) : null;

  return (
    <div
      className={cn(
        "group/comment relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-3",
        isBotUser &&
          "bg-[rgba(212,136,58,0.04)] before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--accent)]",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="pt-0.5">
        {isBotUser ? (
          <span className="bg-accent-muted text-accent-text border-border-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-full border">
            <Sparkles size={10} />
          </span>
        ) : (
          <GitHubAvatar
            login={comment.user.login}
            size={18}
            avatarUrl={comment.user.avatar_url}
            className="ring-1 ring-[rgba(240,236,230,0.08)]"
          />
        )}
      </div>

      <div className="min-w-0">
        {/* biome-ignore lint: header row toggles minimize on click */}
        <div
          className="flex min-w-0 cursor-pointer items-center gap-1.5"
          onClick={onToggleMinimized}
        >
          <span
            className={cn(
              "truncate text-[12px] font-medium",
              isBotUser ? "text-accent-text" : "text-text-primary",
            )}
          >
            {comment.user.login}
          </span>
          {isBotUser && (
            <InlineMetaBadge className="border-[var(--border-accent)] bg-[var(--accent-muted)] text-[var(--accent-text)]">
              Bot
            </InlineMetaBadge>
          )}
          {severity && (
            <span
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] uppercase"
              style={{ background: severity.bg, color: severity.color }}
            >
              {severity.label}
            </span>
          )}
          {isRoot && reviewThreadState?.isResolved && (
            <InlineMetaBadge className="text-success border-[rgba(61,214,140,0.22)] bg-[rgba(61,214,140,0.08)]">
              <CheckCircle2 size={9} />
              Resolved
            </InlineMetaBadge>
          )}
          {isRoot && reviewThreadState?.isOutdated && !reviewThreadState?.isResolved && (
            <InlineMetaBadge className="text-text-tertiary border-border-subtle bg-bg-root/70">
              Outdated
            </InlineMetaBadge>
          )}
          <span className="text-text-tertiary font-mono text-[10px]">
            {relativeTime(new Date(comment.created_at))}
          </span>
          {/* Stop propagation on interactive children so they don't trigger minimize */}
          <div
            className="ml-auto flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {isRoot && reviewActionsEnabled && reviewThreadState && (
              <ThreadResolveButton
                threadId={reviewThreadState.threadId}
                initialResolved={reviewThreadState.isResolved}
              />
            )}
            {minimized ? (
              <ChevronRight
                size={12}
                className="text-text-ghost"
              />
            ) : (
              <ChevronDown
                size={12}
                className="text-text-ghost"
              />
            )}
          </div>
        </div>

        {!minimized && (
          <div className="mt-1.5 min-w-0 space-y-2 pb-0.5">
            {bodyParts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <MarkdownBody
                    key={`text-${i}`}
                    content={part.content}
                    className="text-text-secondary text-[12px] leading-[1.55]"
                  />
                );
              }
              return (
                <SuggestionBlock
                  key={`suggestion-${i}`}
                  suggestion={part.content}
                  language={inferLanguage(comment.path)}
                />
              );
            })}
            {bodyParts.length === 0 && suggestions.length === 0 && (
              <MarkdownBody
                content={comment.body}
                className="text-text-secondary text-[12px] leading-[1.55]"
              />
            )}
            {comment.node_id && prNumber && (
              <ReactionBar
                reactions={reactions ?? []}
                subjectId={comment.node_id}
                prNumber={prNumber}
              />
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <CommentContextMenu
          comment={comment}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onReply={onReply}
          prNumber={prNumber}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion block rendering
// ---------------------------------------------------------------------------

interface BodyPart {
  type: "text" | "suggestion";
  content: string;
}

function parseSuggestions(body: string): { bodyParts: BodyPart[]; suggestions: string[] } {
  const regex = /```suggestion\n([\s\S]*?)```/g;
  const parts: BodyPart[] = [];
  const suggestions: string[] = [];
  let lastIndex = 0;

  let match = regex.exec(body);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: body.slice(lastIndex, match.index) });
    }
    const suggestion = match[1] ?? "";
    parts.push({ type: "suggestion", content: suggestion });
    suggestions.push(suggestion);
    lastIndex = match.index + match[0].length;
    match = regex.exec(body);
  }

  if (lastIndex < body.length) {
    parts.push({ type: "text", content: body.slice(lastIndex) });
  }

  return { bodyParts: parts, suggestions };
}

function SuggestionBlock({ suggestion, language }: { suggestion: string; language: string }) {
  const highlighter = useSyntaxHighlighter();
  const { codeThemeDark, codeThemeLight, resolvedTheme } = useTheme();
  const shikiTheme = useMemo(
    () => ({
      light: codeThemeLight,
      dark: codeThemeDark,
    }),
    [codeThemeDark, codeThemeLight],
  );
  const lines = suggestion.split("\n");

  // Tokenize lines for syntax highlighting.
  // Strip +/- prefixes, join into full code block for context-aware highlighting,
  // Then map per-line tokens back.
  const tokensByLine = useMemo(() => {
    if (!highlighter || language === "text") {
      return null;
    }
    try {
      if (!highlighter.getLoadedLanguages().includes(language)) {
        return null;
      }
      const strippedLines = lines.map((l) =>
        l.startsWith("+") || l.startsWith("-") ? l.slice(1) : l,
      );
      const result = highlighter.codeToTokens(strippedLines.join("\n"), {
        lang: language as Parameters<typeof highlighter.codeToTokens>[1]["lang"],
        themes: {
          light: shikiTheme.light,
          dark: shikiTheme.dark,
        },
      } as unknown as Parameters<typeof highlighter.codeToTokens>[1]);
      return result.tokens.map((lineTokens) => lineTokens.map((token) => token as ShikiToken));
    } catch {
      return null;
    }
  }, [highlighter, language, lines, shikiTheme]);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-[rgba(61,214,140,0.15)] bg-[rgba(61,214,140,0.06)]">
      <div className="flex items-center gap-[5px] px-2 py-1.5 text-[10px] font-semibold text-[var(--success)]">
        <Check size={11} />
        Suggested fix
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-[4px] bg-[var(--success)] px-2.5 py-1 text-[10px] font-semibold text-[var(--bg-root)] transition-shadow hover:shadow-[0_0_10px_rgba(61,214,140,0.22)]"
          onClick={() => {
            void navigator.clipboard.writeText(suggestion);
            toastManager.add({ title: "Suggestion copied", type: "success" });
          }}
        >
          Copy fix
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "4px 10px 6px",
          background: "transparent",
          border: "none",
          borderTop: "1px solid rgba(61,214,140,0.1)",
          borderRadius: 0,
          overflow: "auto",
        }}
      >
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: "18px",
            padding: 0,
            background: "none",
            border: "none",
          }}
        >
          {lines.map((line, i) => {
            const lineTokens = tokensByLine?.[i];
            const content = lineTokens
              ? lineTokens.map((token, ti) => (
                  <span
                    key={ti}
                    style={{ color: getShikiTokenColor(token, resolvedTheme) }}
                  >
                    {token.content}
                  </span>
                ))
              : line.startsWith("+") || line.startsWith("-")
                ? line.slice(1)
                : line;

            if (line.startsWith("-")) {
              return (
                <div
                  key={i}
                  style={{
                    textDecoration: "line-through",
                    opacity: 0.7,
                    background: "rgba(248,81,73,0.1)",
                  }}
                >
                  {content}
                </div>
              );
            }
            if (line.startsWith("+")) {
              return (
                <div
                  key={i}
                  style={{ background: "rgba(63,185,80,0.1)" }}
                >
                  {content}
                </div>
              );
            }
            return <div key={i}>{content}</div>;
          })}
        </code>
      </pre>
    </div>
  );
}

/**
 * Parse severity from bot comment body.
 * Looks for patterns like [Critical], [Suggestion], [Nitpick], **Critical:**, etc.
 */
function parseSeverity(body: string): { label: string; bg: string; color: string } | null {
  const lower = body.toLowerCase();
  if (
    lower.includes("[critical]") ||
    lower.includes("**critical") ||
    lower.includes("severity: critical") ||
    lower.includes("🔴")
  ) {
    return { label: "Critical", bg: "var(--danger-muted)", color: "var(--danger)" };
  }
  if (
    lower.includes("[suggestion]") ||
    lower.includes("**suggestion") ||
    lower.includes("severity: suggestion")
  ) {
    return { label: "Suggestion", bg: "var(--warning-muted)", color: "var(--warning)" };
  }
  if (
    lower.includes("[nitpick]") ||
    lower.includes("**nitpick") ||
    lower.includes("severity: nitpick") ||
    lower.includes("nit:")
  ) {
    return { label: "Nitpick", bg: "var(--bg-raised)", color: "var(--text-tertiary)" };
  }
  return null;
}

function buildCommentPreview(body: string, maxLength: number): string {
  const flattened = body
    .replaceAll(/```suggestion[\s\S]*?```/g, "Suggested change")
    .replaceAll(/```[\s\S]*?```/g, "Code block")
    .replaceAll(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replaceAll(/^>\s?/gm, "")
    .replaceAll(/^#{1,6}\s+/gm, "")
    .replaceAll(/[*_`~]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

  if (flattened.length === 0) {
    return "Open thread";
  }

  if (flattened.length <= maxLength) {
    return flattened;
  }

  return `${flattened.slice(0, maxLength - 1).trimEnd()}…`;
}
