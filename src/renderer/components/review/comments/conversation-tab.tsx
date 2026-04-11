/* eslint-disable import/max-dependencies -- This timeline surface composes many focused conversation primitives. */
import type { GhReactionGroup, GhReviewThread } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { ReactionBar } from "@/renderer/components/review/comments/reaction-bar";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { CollapsibleDescription } from "@/renderer/components/shared/collapsible-description";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { UserProfileTooltip } from "@/renderer/components/shared/user-profile-tooltip";
import { useBotSettings } from "@/renderer/hooks/preferences/use-bot-settings";
import { useMinimizedComments } from "@/renderer/hooks/review/use-minimized-comments";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  MessageCircle,
  MessageSquare,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Conversation tab — Side Panel → Conversation tab
 *
 * Unresolved threads at top, then chronological timeline of status events
 * and content events. Comment composer pinned at bottom.
 */

interface ConversationTabProps {
  prNumber: number;
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>;
  reviewThreads?: GhReviewThread[];
  repo: string;
  onReviewClick: (login: string) => void;
  /** Reaction data for issue comments, keyed by comment databaseId */
  issueCommentReactions?: Record<string, GhReactionGroup[]>;
}

export function ConversationTab({
  prNumber,
  reviews,
  issueComments,
  reviewThreads,
  repo,
  onReviewClick,
  issueCommentReactions,
}: ConversationTabProps) {
  const { isBot, shouldAutoCollapseBot } = useBotSettings();
  const { isCommentMinimized, toggleMinimized } = useMinimizedComments(repo, prNumber);

  const timeline = buildTimeline({
    reviews,
    issueComments,
    reviewThreads: reviewThreads ?? [],
    isBot,
    issueCommentReactions,
  });

  const unresolvedCount = (reviewThreads ?? []).filter((t) => !t.isResolved).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ padding: "12px" }}
      >
        <div className="space-y-3">
          {/* Unified timeline: status events, content events, and thread entries */}
          {timeline.map((event) => {
            switch (event.type) {
              case "status": {
                return (
                  <StatusEvent
                    key={event.key}
                    login={event.login}
                    action={event.action}
                    time={event.time}
                    state={event.state}
                  />
                );
              }
              case "content": {
                return (
                  <ContentEvent
                    key={event.key}
                    commentId={event.commentId}
                    login={event.login}
                    action={event.action}
                    time={event.time}
                    body={event.body}
                    filePath={event.filePath}
                    repo={repo}
                    isBot={event.isBot}
                    autoCollapse={shouldAutoCollapseBot(event.login)}
                    prNumber={prNumber}
                    onClick={() => onReviewClick(event.login)}
                    minimized={isCommentMinimized(
                      event.commentId,
                      shouldAutoCollapseBot(event.login),
                    )}
                    onToggleMinimized={() =>
                      toggleMinimized(event.commentId, shouldAutoCollapseBot(event.login))
                    }
                    reactions={event.reactions}
                  />
                );
              }
              case "thread": {
                return (
                  <UnresolvedThreadItem
                    key={event.key}
                    thread={event.thread}
                    onClick={() => {
                      const first = event.thread.comments[0];
                      if (first) {
                        onReviewClick(first.author.login);
                      }
                    }}
                  />
                );
              }
            }
          })}

          {/* Empty state */}
          {timeline.length === 0 && unresolvedCount === 0 && (
            <div className="py-8 text-center">
              <p
                className="text-sm"
                style={{ color: "rgba(94, 89, 84, 0.6)" }}
              >
                No conversation yet
              </p>
            </div>
          )}
        </div>
      </div>

      <PanelComposer prNumber={prNumber} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline builder
// ---------------------------------------------------------------------------

interface StatusTimelineEvent {
  type: "status";
  key: string;
  login: string;
  action: string;
  time: Date;
  state: string;
  dotColor: string;
  actionColor?: string;
}

interface ContentTimelineEvent {
  type: "content";
  key: string;
  commentId: string;
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  isBot: boolean;
  reactions?: GhReactionGroup[];
}

interface ThreadTimelineEvent {
  type: "thread";
  key: string;
  thread: GhReviewThread;
  time: Date;
}

type TimelineEvent = StatusTimelineEvent | ContentTimelineEvent | ThreadTimelineEvent;

function buildTimeline({
  reviews,
  issueComments,
  reviewThreads,
  isBot,
  issueCommentReactions,
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>;
  reviewThreads: GhReviewThread[];
  isBot: (login: string) => boolean;
  issueCommentReactions?: Record<string, GhReactionGroup[]>;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const review of reviews) {
    const { state } = review;
    let action = "reviewed";
    let dotColor = "var(--text-ghost)";
    let actionColor: string | undefined = undefined;

    if (state === "APPROVED") {
      action = "approved";
      dotColor = "var(--success)";
      actionColor = "var(--success)";
    } else if (state === "CHANGES_REQUESTED") {
      action = "requested changes";
      dotColor = "var(--danger)";
      actionColor = "var(--danger)";
    } else if (state === "COMMENTED") {
      action = "commented";
      dotColor = "var(--text-ghost)";
    } else if (state === "DISMISSED") {
      action = "dismissed review";
      dotColor = "var(--text-ghost)";
    }

    events.push({
      type: "status",
      key: `review-${review.author.login}-${review.submittedAt}`,
      login: review.author.login,
      action,
      state,
      time: new Date(review.submittedAt),
      dotColor,
      actionColor,
    });
  }

  for (const comment of issueComments) {
    events.push({
      type: "content",
      key: `comment-${comment.id}`,
      commentId: comment.id,
      login: comment.author.login,
      action: "commented",
      time: new Date(comment.createdAt),
      body: comment.body,
      isBot: isBot(comment.author.login),
      reactions: issueCommentReactions?.[comment.id],
    });
  }

  for (const thread of reviewThreads) {
    if (thread.comments.length > 0) {
      events.push({
        type: "thread",
        key: `thread-${thread.id}`,
        thread,
        // Threads lack timestamps — place them after all dated events
        time: new Date(0),
      });
    }
  }

  events.sort((a, b) => a.time.getTime() - b.time.getTime());
  return events;
}

// ---------------------------------------------------------------------------
// Status event config — mirrors better-hub's reviewStateBadge / StateChangeEvent
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { icon: typeof Check; label: string; className: string }> = {
  APPROVED: {
    icon: Check,
    label: "approved",
    className: "status-success",
  },
  CHANGES_REQUESTED: {
    icon: AlertCircle,
    label: "requested changes",
    className: "status-danger",
  },
  COMMENTED: {
    icon: MessageCircle,
    label: "commented",
    className: "status-muted",
  },
  DISMISSED: {
    icon: MessageCircle,
    label: "dismissed review",
    className: "status-muted",
  },
};

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  "status-success": {
    bg: "rgba(61, 214, 140, 0.05)",
    border: "rgba(61, 214, 140, 0.2)",
    color: "var(--success)",
  },
  "status-danger": {
    bg: "rgba(239, 100, 97, 0.05)",
    border: "rgba(239, 100, 97, 0.2)",
    color: "var(--danger)",
  },
  "status-muted": {
    bg: "rgba(255, 255, 255, 0.015)",
    border: "rgba(255, 255, 255, 0.05)",
    color: "var(--text-tertiary)",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusEvent({
  login,
  action,
  time,
  state,
}: {
  login: string;
  action: string;
  time: Date;
  state: string;
}) {
  const config = STATUS_CONFIG[state] ?? STATUS_CONFIG.COMMENTED!;
  const styles = STATUS_STYLES[config.className] ?? STATUS_STYLES["status-muted"]!;
  const Icon = config.icon;

  return (
    <div
      className="flex items-center gap-2.5 overflow-hidden rounded-lg"
      style={{
        padding: "6px 10px",
        background: styles.bg,
        border: `1px solid ${styles.border}`,
      }}
    >
      <Icon
        size={14}
        className="shrink-0"
        style={{ color: styles.color }}
      />
      <UserProfileTooltip login={login}>
        <GitHubAvatar
          login={login}
          size={16}
          className="shrink-0 rounded-full"
        />
      </UserProfileTooltip>
      <span
        className="text-xs font-medium"
        style={{ color: "rgba(240, 236, 230, 0.8)" }}
      >
        {login}
      </span>
      <span
        className="rounded border text-[9px]"
        style={{
          padding: "0 5px",
          lineHeight: "16px",
          color: styles.color,
          borderColor: styles.border,
          background: styles.bg,
        }}
      >
        {action}
      </span>
      <span
        className="ml-auto shrink-0 text-[10px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {relativeTime(time)}
      </span>
    </div>
  );
}

export function ContentEvent({
  commentId,
  login,
  action,
  time,
  body,
  filePath,
  repo,
  isBot: isBotUser,
  autoCollapse,
  prNumber,
  onClick,
  minimized,
  onToggleMinimized,
  reactions,
}: {
  commentId: string;
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  repo: string;
  isBot: boolean;
  autoCollapse: boolean;
  prNumber: number;
  onClick: () => void;
  minimized: boolean;
  onToggleMinimized: () => void;
  reactions?: GhReactionGroup[];
}) {
  const { nwo } = useWorkspace();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const severity = isBotUser ? parseBotSeverity(body) : null;

  return (
    <div
      className="group"
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Card — mirrors better-hub ChatMessageWrapper */}
      <div
        className="overflow-hidden rounded-lg"
        style={{
          border: isBotUser
            ? "1px solid rgba(212, 136, 58, 0.2)"
            : "1px solid rgba(37, 35, 31, 0.6)",
        }}
      >
        {/* Header — bg-card/50 equivalent */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!minimized}
          aria-label={minimized ? `Expand comment from ${login}` : `Minimize comment from ${login}`}
          data-action={action}
          className="flex cursor-pointer items-center gap-2 transition-colors focus-visible:ring-1 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          style={{
            padding: "6px 12px",
            background: isBotUser ? "rgba(212, 136, 58, 0.03)" : "rgba(22, 22, 27, 0.5)",
            borderBottom: minimized
              ? "none"
              : isBotUser
                ? "1px solid rgba(212, 136, 58, 0.1)"
                : "1px solid rgba(37, 35, 31, 0.6)",
          }}
          onClick={onToggleMinimized}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleMinimized();
            }
          }}
        >
          <UserProfileTooltip login={login}>
            <GitHubAvatar
              login={login}
              size={16}
              className="shrink-0 rounded-full"
            />
          </UserProfileTooltip>
          <span
            className="text-xs font-medium"
            style={{
              color: isBotUser ? "var(--accent-text)" : "rgba(240, 236, 230, 0.8)",
            }}
          >
            {login}
          </span>
          {isBotUser && (
            <span
              className="rounded text-[9px]"
              style={{
                padding: "0 4px",
                border: "1px solid rgba(212, 136, 58, 0.25)",
                color: "rgba(94, 89, 84, 0.5)",
                lineHeight: "16px",
              }}
            >
              bot
            </span>
          )}
          {severity && (
            <span
              className="rounded text-[9px] font-medium"
              style={{
                padding: "0 5px",
                border: `1px solid ${severity.border}`,
                background: severity.bg,
                color: severity.color,
                lineHeight: "16px",
              }}
            >
              {severity.label}
            </span>
          )}
          <span
            className="ml-auto shrink-0 text-[10px]"
            style={{ color: "rgba(94, 89, 84, 0.5)" }}
          >
            {relativeTime(time)}
          </span>
          <ChevronDown
            size={12}
            className="shrink-0 transition-transform duration-150"
            style={{
              color: "var(--text-ghost)",
              transform: minimized ? "rotate(-90deg)" : undefined,
            }}
          />
        </div>

        {/* Body */}
        {!minimized && (
          <>
            <div style={{ padding: "8px 12px 10px" }}>
              {filePath && (
                <div
                  className="cursor-pointer font-mono text-[10px] transition-colors hover:underline"
                  style={{ color: "var(--info)", marginBottom: "6px" }}
                  onClick={onClick}
                >
                  {filePath}
                </div>
              )}
              <div
                className="text-xs leading-relaxed"
                style={{ color: "rgba(155, 149, 144, 0.9)" }}
              >
                <CollapsibleDescription maxHeight={200}>
                  <MarkdownBody
                    content={body}
                    repo={repo}
                  />
                </CollapsibleDescription>
              </div>
            </div>
            <div style={{ padding: "0 12px 8px" }}>
              <ReactionBar
                reactions={reactions ?? []}
                subjectId={commentId}
                prNumber={prNumber}
              />
            </div>
          </>
        )}

        {autoCollapse && minimized && (
          <div
            className="text-[10px]"
            style={{ padding: "0 12px 6px", color: "var(--text-ghost)" }}
          >
            Auto-collapsed for this bot
          </div>
        )}
      </div>

      {contextMenu && (
        <ConvoContextMenu
          commentId={commentId}
          body={body}
          prNumber={prNumber}
          nwo={nwo}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function ConvoContextMenu({
  commentId,
  body,
  prNumber,
  nwo,
  position,
  onClose,
}: {
  commentId: string;
  body: string;
  prNumber: number;
  nwo: string;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClick, handleEscape]);

  const commentUrl = `https://github.com/${nwo}/pull/${prNumber}#issuecomment-${commentId}`;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-md p-1 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      <ConvoMenuItem
        icon={<Copy size={12} />}
        label="Copy text"
        onClick={() => {
          navigator.clipboard.writeText(body);
          toastManager.add({ title: "Copied", type: "success" });
          onClose();
        }}
      />
      <ConvoMenuItem
        icon={<Copy size={12} />}
        label="Copy link"
        onClick={() => {
          navigator.clipboard.writeText(commentUrl);
          toastManager.add({ title: "Link copied", type: "success" });
          onClose();
        }}
      />
      <ConvoMenuItem
        icon={<ExternalLink size={12} />}
        label="Open in browser"
        onClick={() => {
          void openExternal(commentUrl);
          onClose();
        }}
      />
      <div style={{ height: "1px", background: "var(--border)", margin: "2px 0" }} />
      <ConvoMenuItem
        icon={<MessageSquare size={12} />}
        label="Quote reply"
        onClick={() => {
          const quoted = body
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

function ConvoMenuItem({
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
      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors"
      style={{ color: "var(--text-secondary)" }}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Unresolved / resolved thread items
// ---------------------------------------------------------------------------

function UnresolvedThreadItem({
  thread,
  onClick,
}: {
  thread: GhReviewThread;
  onClick: () => void;
}) {
  const [firstComment] = thread.comments;
  if (!firstComment) {
    return null;
  }

  const preview =
    firstComment.body.length > 120 ? `${firstComment.body.slice(0, 120)}...` : firstComment.body;
  const replyCount = thread.comments.length - 1;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer overflow-hidden rounded-lg text-left"
      style={{ border: "1px solid rgba(37, 35, 31, 0.6)" }}
    >
      {/* Header — same bg-card/50 pattern as ContentEvent */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "6px 10px",
          background: "rgba(22, 22, 27, 0.5)",
          borderBottom: "1px solid rgba(37, 35, 31, 0.6)",
        }}
      >
        <MessageSquare
          size={11}
          className="shrink-0"
          style={{ color: thread.isResolved ? "var(--success)" : "var(--warning)" }}
        />
        <span
          className="text-[11px] font-medium"
          style={{ color: "rgba(240, 236, 230, 0.8)" }}
        >
          {firstComment.author.login}
        </span>
        <span
          className="rounded border text-[9px]"
          style={{
            padding: "0 5px",
            lineHeight: "16px",
            color: thread.isResolved ? "var(--success)" : "var(--warning)",
            borderColor: thread.isResolved
              ? "rgba(61, 214, 140, 0.2)"
              : "rgba(240, 180, 73, 0.2)",
            background: thread.isResolved
              ? "rgba(61, 214, 140, 0.05)"
              : "rgba(240, 180, 73, 0.05)",
          }}
        >
          {thread.isResolved ? "resolved" : "unresolved"}
        </span>
        {thread.path && (
          <span
            className="ml-auto max-w-[45%] truncate font-mono text-[9px]"
            style={{ color: "var(--text-ghost)" }}
          >
            {thread.path}
          </span>
        )}
      </div>
      {/* Body */}
      <div style={{ padding: "6px 10px 8px" }}>
        <p
          className="text-[11px] leading-[1.4]"
          style={{
            color: "rgba(155, 149, 144, 0.7)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {preview}
        </p>
        {replyCount > 0 && (
          <span
            className="mt-1 inline-block text-[10px]"
            style={{ color: "var(--text-ghost)" }}
          >
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBotSeverity(
  body: string,
): { label: string; bg: string; border: string; color: string } | null {
  const lower = body.toLowerCase();
  if (lower.includes("[critical]") || lower.includes("**critical") || lower.includes("🔴")) {
    return {
      label: "Critical",
      bg: "rgba(239, 100, 97, 0.05)",
      border: "rgba(239, 100, 97, 0.2)",
      color: "var(--danger)",
    };
  }
  if (lower.includes("[suggestion]") || lower.includes("**suggestion")) {
    return {
      label: "Suggestion",
      bg: "rgba(240, 180, 73, 0.05)",
      border: "rgba(240, 180, 73, 0.2)",
      color: "var(--warning)",
    };
  }
  if (lower.includes("[nitpick]") || lower.includes("**nitpick") || lower.includes("nit:")) {
    return {
      label: "Nitpick",
      bg: "rgba(255, 255, 255, 0.015)",
      border: "rgba(255, 255, 255, 0.05)",
      color: "var(--text-tertiary)",
    };
  }
  return null;
}

function PanelComposer({ prNumber }: { prNumber: number }) {
  const { repoTarget } = useWorkspace();
  const [body, setBody] = useState("");

  const commentMutation = useMutation({
    mutationFn: (args: { body: string }) => ipc("pr.comment", { ...repoTarget, prNumber, ...args }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "issueComments"] });
      toastManager.add({ title: "Comment added", type: "success" });
      setBody("");
    },
    onError: (err: Error) => {
      toastManager.add({ title: "Comment failed", description: err.message, type: "error" });
    },
  });

  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

  return (
    <div
      className="shrink-0"
      style={{ borderTop: "1px solid var(--border)", padding: "10px 12px" }}
    >
      <ReviewMarkdownComposer
        collapseWhenIdle
        compact
        onChange={setBody}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            commentMutation.mutate({ body: body.trim() });
          }
        }}
        placeholder="Leave a comment..."
        prNumber={prNumber}
        rows={3}
        value={body}
      />
      <div
        className="text-text-ghost font-mono"
        style={{ fontSize: "10px", marginTop: "3px" }}
      >
        {isMac ? "⌘" : "Ctrl"}+Enter to submit
      </div>
    </div>
  );
}
