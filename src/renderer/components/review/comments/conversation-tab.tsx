/* eslint-disable import/max-dependencies -- This timeline surface composes many focused conversation primitives. */
import type { GhIssueComment, GhReactionGroup, GhReviewThread } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
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
  Pencil,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function isCurrentUserCommentAuthor(
  currentUserLogin: string | null | undefined,
  commentAuthorLogin: string,
): boolean {
  if (!currentUserLogin) {
    return false;
  }
  return currentUserLogin.trim().toLowerCase() === commentAuthorLogin.trim().toLowerCase();
}

/**
 * Conversation tab — Side Panel → Conversation tab
 *
 * Unresolved threads at top, then chronological timeline of status events
 * and content events. Comment composer pinned at bottom.
 */

interface ConversationTabProps {
  prNumber: number;
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  issueComments: GhIssueComment[];
  reviewThreads?: GhReviewThread[];
  repo: string;
  currentUserLogin?: string | null;
  onReviewClick: (login: string) => void;
  /** Navigate to a thread's file and scroll to the comment */
  onThreadClick?: (path: string, line: number | null) => void;
  /** Reaction data for issue comments, keyed by GraphQL node ID. */
  issueCommentReactions?: Record<string, GhReactionGroup[]>;
}

export function ConversationTab({
  prNumber,
  reviews,
  issueComments,
  reviewThreads,
  repo,
  currentUserLogin,
  onReviewClick,
  onThreadClick,
  issueCommentReactions,
}: ConversationTabProps) {
  const { isBot, shouldAutoCollapseBot, hideBotChatInConversations } = useBotSettings();
  const { isCommentMinimized, toggleMinimized } = useMinimizedComments(repo, prNumber);
  const [searchQuery, setSearchQuery] = useState("");

  const timeline = buildTimeline({
    reviews,
    issueComments,
    reviewThreads: reviewThreads ?? [],
    isBot,
    currentUserLogin,
    issueCommentReactions,
  });
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleTimeline = useMemo(
    () =>
      hideBotChatInConversations
        ? timeline.filter((event) => event.type !== "content" || !event.isBot)
        : timeline,
    [hideBotChatInConversations, timeline],
  );
  const filteredTimeline = useMemo(
    () =>
      normalizedSearchQuery.length === 0
        ? visibleTimeline
        : visibleTimeline.filter((event) =>
            matchesConversationSearch(event, normalizedSearchQuery),
          ),
    [normalizedSearchQuery, visibleTimeline],
  );

  const unresolvedCount = (reviewThreads ?? []).filter((t) => !t.isResolved).length;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-review-focus-target="panel-conversation"
      tabIndex={-1}
    >
      <div className="border-border shrink-0 border-b px-3 py-2">
        <div className="border-border bg-bg-raised flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search
            size={11}
            className="text-text-tertiary shrink-0"
          />
          <input
            data-review-focus-target="panel-search"
            aria-label="Search conversation"
            autoComplete="off"
            name="panel-conversation-search"
            spellCheck={false}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              handleSearchInputEscape(event);
            }}
            placeholder="Search conversation…"
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] focus:outline-none"
          />
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ padding: "12px" }}
      >
        <div className="space-y-3">
          {/* Unified timeline: status events, content events, and thread entries */}
          {filteredTimeline.map((event) => {
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
                    databaseId={event.databaseId}
                    login={event.login}
                    action={event.action}
                    time={event.time}
                    body={event.body}
                    filePath={event.filePath}
                    repo={repo}
                    isBot={event.isBot}
                    canEdit={event.canEdit}
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
                      if (onThreadClick) {
                        onThreadClick(event.thread.path, event.thread.line);
                      } else {
                        const [first] = event.thread.comments;
                        if (first) {
                          onReviewClick(first.author.login);
                        }
                      }
                    }}
                  />
                );
              }
              default: {
                return null;
              }
            }
          })}

          {/* Empty state */}
          {filteredTimeline.length === 0 && normalizedSearchQuery.length > 0 && (
            <div className="py-8 text-center">
              <p
                className="text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                No conversation matches “{searchQuery.trim()}”
              </p>
            </div>
          )}
          {filteredTimeline.length === 0 &&
            normalizedSearchQuery.length === 0 &&
            unresolvedCount === 0 && (
              <div className="py-8 text-center">
                <p
                  className="text-sm"
                  style={{ color: "var(--text-tertiary)" }}
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
  databaseId: number;
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  isBot: boolean;
  canEdit: boolean;
  reactions?: GhReactionGroup[];
}

interface ThreadTimelineEvent {
  type: "thread";
  key: string;
  thread: GhReviewThread;
  time: Date;
}

type TimelineEvent = StatusTimelineEvent | ContentTimelineEvent | ThreadTimelineEvent;

function matchesConversationSearch(event: TimelineEvent, query: string): boolean {
  if (event.type === "status") {
    return [event.login, event.action, event.state].join("\n").toLowerCase().includes(query);
  }

  if (event.type === "content") {
    return [event.login, event.action, event.body, event.filePath ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(query);
  }

  return [
    event.thread.path,
    event.thread.line === null ? "" : String(event.thread.line),
    ...event.thread.comments.map((comment) => `${comment.author.login}\n${comment.body}`),
  ]
    .join("\n")
    .toLowerCase()
    .includes(query);
}

function buildTimeline({
  reviews,
  issueComments,
  reviewThreads,
  isBot,
  currentUserLogin,
  issueCommentReactions,
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  issueComments: GhIssueComment[];
  reviewThreads: GhReviewThread[];
  isBot: (login: string) => boolean;
  currentUserLogin?: string | null;
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
      key: `comment-${comment.nodeId}`,
      commentId: comment.nodeId,
      databaseId: comment.databaseId,
      login: comment.author.login,
      action: "commented",
      time: new Date(comment.createdAt),
      body: comment.body,
      isBot: isBot(comment.author.login),
      canEdit: isCurrentUserCommentAuthor(currentUserLogin, comment.author.login),
      reactions: issueCommentReactions?.[comment.nodeId],
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

interface StatusConfig {
  icon: typeof Check;
  label: string;
  className: string;
}

interface StatusStyle {
  bg: string;
  border: string;
  color: string;
}

const FALLBACK_STATUS_CONFIG: StatusConfig = {
  icon: MessageCircle,
  label: "commented",
  className: "status-muted",
};

const FALLBACK_STATUS_STYLE: StatusStyle = {
  bg: "var(--bg-surface)",
  border: "var(--border-subtle)",
  color: "var(--text-tertiary)",
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
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
  COMMENTED: FALLBACK_STATUS_CONFIG,
  DISMISSED: {
    icon: MessageCircle,
    label: "dismissed review",
    className: "status-muted",
  },
};

const STATUS_STYLES: Record<string, StatusStyle> = {
  "status-success": {
    bg: "var(--success-muted)",
    border: "color-mix(in srgb, var(--success) 20%, transparent)",
    color: "var(--success)",
  },
  "status-danger": {
    bg: "var(--danger-muted)",
    border: "color-mix(in srgb, var(--danger) 20%, transparent)",
    color: "var(--danger)",
  },
  "status-muted": FALLBACK_STATUS_STYLE,
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
  const config = STATUS_CONFIG[state] ?? FALLBACK_STATUS_CONFIG;
  const styles = STATUS_STYLES[config.className] ?? FALLBACK_STATUS_STYLE;
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
        style={{ color: "var(--text-primary)" }}
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
  databaseId,
  login,
  action,
  time,
  body,
  filePath,
  repo,
  isBot: isBotUser,
  canEdit,
  autoCollapse,
  prNumber,
  onClick,
  minimized,
  onToggleMinimized,
  reactions,
}: {
  commentId: string;
  databaseId: number;
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  repo: string;
  isBot: boolean;
  canEdit: boolean;
  autoCollapse: boolean;
  prNumber: number;
  onClick: () => void;
  minimized: boolean;
  onToggleMinimized: () => void;
  reactions?: GhReactionGroup[];
}) {
  const { nwo, repoTarget } = useWorkspace();
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const severity = isBotUser ? parseBotSeverity(body) : null;
  const trimmedEditBody = editBody.trim();

  const editMutation = useMutation({
    mutationFn: ({ body: editBodyText }: { body: string }) =>
      ipc("pr.editIssueComment", {
        ...repoTarget,
        prNumber,
        commentId: databaseId,
        body: editBodyText,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "issueComments"] });
      toastManager.add({ title: "Comment updated", type: "success" });
      setIsEditing(false);
    },
    onError: (error) => {
      toastManager.add({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Could not save the edited comment.",
        type: "error",
      });
    },
  });

  const canSaveEdit =
    Boolean(trimmedEditBody) && trimmedEditBody !== body && !editMutation.isPending;

  function handleStartEdit() {
    setEditBody(body);
    setIsEditing(true);
    setContextMenu(null);
    if (minimized) {
      onToggleMinimized();
    }
  }

  function handleEditSubmit() {
    if (!canSaveEdit) {
      return;
    }

    editMutation.mutate({ body: trimmedEditBody });
  }

  function handleEditCancel() {
    setIsEditing(false);
    setEditBody(body);
  }

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
          border: isBotUser ? "1px solid var(--border-accent)" : "1px solid var(--border)",
        }}
      >
        {/* Header — bg-card/50 equivalent */}
        <button
          type="button"
          aria-expanded={!minimized}
          aria-label={minimized ? `Expand comment from ${login}` : `Minimize comment from ${login}`}
          data-action={action}
          className="flex w-full cursor-pointer items-center gap-2 text-left transition-colors focus-visible:ring-1 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          style={{
            padding: "6px 12px",
            background: isBotUser ? "var(--accent-muted)" : "var(--bg-surface)",
            borderBottom: minimized
              ? "none"
              : isBotUser
                ? "1px solid var(--border-accent)"
                : "1px solid var(--border)",
          }}
          onClick={onToggleMinimized}
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
              color: isBotUser ? "var(--accent-text)" : "var(--text-primary)",
            }}
          >
            {login}
          </span>
          {isBotUser && (
            <span
              className="rounded text-[9px]"
              style={{
                padding: "0 4px",
                border: "1px solid var(--border-accent)",
                color: "var(--text-ghost)",
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
            style={{ color: "var(--text-ghost)" }}
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
        </button>

        {/* Body */}
        {!minimized && (
          <>
            <div style={{ padding: "8px 12px 10px" }}>
              {filePath && (
                <button
                  type="button"
                  className="cursor-pointer font-mono text-[10px] transition-colors hover:underline"
                  style={{ color: "var(--info)", marginBottom: "6px" }}
                  onClick={onClick}
                >
                  {filePath}
                </button>
              )}
              <div
                className="text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <ReviewMarkdownComposer
                      autoFocus
                      compact
                      onChange={setEditBody}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSaveEdit) {
                          e.preventDefault();
                          handleEditSubmit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleEditCancel();
                        }
                      }}
                      placeholder="Edit comment…"
                      prNumber={prNumber}
                      rows={3}
                      value={editBody}
                    />
                    <div className="flex items-center justify-end gap-1.5 pt-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={handleEditCancel}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        disabled={!canSaveEdit}
                        onClick={handleEditSubmit}
                      >
                        {editMutation.isPending ? <Spinner className="h-3 w-3" /> : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <CollapsibleDescription maxHeight={200}>
                    <MarkdownBody
                      content={body}
                      repo={repo}
                    />
                  </CollapsibleDescription>
                )}
              </div>
            </div>
            {!isEditing && (
              <div style={{ padding: "0 12px 8px" }}>
                <ReactionBar
                  reactions={reactions ?? []}
                  subjectId={commentId}
                  prNumber={prNumber}
                />
              </div>
            )}
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
          databaseId={databaseId}
          body={body}
          prNumber={prNumber}
          nwo={nwo}
          position={contextMenu}
          canEdit={canEdit && !isBotUser}
          onEdit={handleStartEdit}
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
  databaseId,
  body,
  prNumber,
  nwo,
  position,
  canEdit,
  onEdit,
  onClose,
}: {
  databaseId: number;
  body: string;
  prNumber: number;
  nwo: string;
  position: { x: number; y: number };
  canEdit?: boolean;
  onEdit?: () => void;
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

  const commentUrl = `https://github.com/${nwo}/pull/${prNumber}#issuecomment-${databaseId}`;

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
        icon={<Pencil size={12} />}
        label="Edit"
        onClick={() => {
          if (canEdit && onEdit) {
            onEdit();
          }
          onClose();
        }}
        disabled={!canEdit}
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
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  if (disabled) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[11px] transition-colors"
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
      data-review-thread-id={thread.id}
      data-review-thread-state={thread.isResolved ? "resolved" : "open"}
      className="focus:ring-border-accent/70 w-full cursor-pointer overflow-hidden rounded-lg text-left focus:ring-1 focus:outline-none focus:ring-inset"
      style={{
        border: thread.isResolved
          ? "1px solid color-mix(in srgb, var(--success) 15%, transparent)"
          : "1px solid var(--border)",
        opacity: thread.isResolved ? 0.6 : 1,
      }}
    >
      {/* Header — same bg-card/50 pattern as ContentEvent */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "6px 10px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <MessageSquare
          size={11}
          className="shrink-0"
          style={{ color: thread.isResolved ? "var(--success)" : "var(--warning)" }}
        />
        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--text-primary)" }}
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
              ? "color-mix(in srgb, var(--success) 20%, transparent)"
              : "color-mix(in srgb, var(--warning) 20%, transparent)",
            background: thread.isResolved ? "var(--success-muted)" : "var(--warning-muted)",
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
            color: "var(--text-secondary)",
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
      bg: "var(--danger-muted)",
      border: "color-mix(in srgb, var(--danger) 20%, transparent)",
      color: "var(--danger)",
    };
  }
  if (lower.includes("[suggestion]") || lower.includes("**suggestion")) {
    return {
      label: "Suggestion",
      bg: "var(--warning-muted)",
      border: "color-mix(in srgb, var(--warning) 20%, transparent)",
      color: "var(--warning)",
    };
  }
  if (lower.includes("[nitpick]") || lower.includes("**nitpick") || lower.includes("nit:")) {
    return {
      label: "Nitpick",
      bg: "var(--bg-surface)",
      border: "var(--border-subtle)",
      color: "var(--text-tertiary)",
    };
  }
  return null;
}

export function PanelComposer({ prNumber }: { prNumber: number }) {
  const { repoTarget } = useWorkspace();
  const [body, setBody] = useState("");
  const trimmedBody = body.trim();

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

  function handleSubmit() {
    if (!trimmedBody) {
      return;
    }

    commentMutation.mutate({ body: trimmedBody });
  }

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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmedBody) {
            e.preventDefault();
            handleSubmit();
            return;
          }

          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setBody("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Leave a comment…"
        prNumber={prNumber}
        rows={3}
        value={body}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div
          className="text-text-ghost font-mono"
          style={{ fontSize: "10px" }}
        >
          {isMac ? "⌘" : "Ctrl"}+Enter to submit · Esc to cancel
        </div>
        <Button
          size="xs"
          className="shrink-0"
          disabled={!trimmedBody || commentMutation.isPending}
          onClick={handleSubmit}
        >
          {commentMutation.isPending ? <Spinner className="h-3 w-3" /> : "Comment"}
        </Button>
      </div>
    </div>
  );
}
