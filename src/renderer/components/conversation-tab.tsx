import type { GhReactionGroup, GhReviewThread } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { relativeTime } from "@/shared/format";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, ExternalLink, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBotSettings } from "../hooks/use-bot-settings";
import { useMinimizedComments } from "../hooks/use-minimized-comments";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";
import { MarkdownBody } from "./markdown-body";
import { MentionTextarea } from "./mention-textarea";
import { ReactionBar } from "./reaction-bar";

/**
 * Conversation tab — PR-REVIEW-REDESIGN.md § Side Panel → Conversation tab
 *
 * Timeline of events: unresolved section at top, then chronological timeline
 * of status events (compact) and content events (full comments).
 * Comment composer at bottom.
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
  const { isBot } = useBotSettings();
  const { minimizedSet, toggleMinimized } = useMinimizedComments(repo, prNumber);

  // Build a unified timeline from reviews (status events) and issue comments (content events)
  const timeline = buildTimeline(reviews, issueComments, isBot, issueCommentReactions);

  // Thread resolution counts from GitHub's reviewThreads data
  const unresolvedThreads = (reviewThreads ?? []).filter((t) => !t.isResolved);
  const resolvedThreads = (reviewThreads ?? []).filter((t) => t.isResolved);
  const unresolvedCount = unresolvedThreads.length;
  const resolvedCount = resolvedThreads.length;
  const [showResolved, setShowResolved] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ padding: "12px" }}
      >
        {/* Unresolved section */}
        {unresolvedCount > 0 && (
          <>
            <SectionLabel
              dotColor="var(--warning)"
              label={`Unresolved · ${unresolvedCount}`}
            />
            {unresolvedThreads.map((thread) => (
              <UnresolvedThreadItem
                key={thread.id}
                thread={thread}
                onClick={() => {
                  if (thread.comments[0]) {
                    onReviewClick(thread.comments[0].author.login);
                  }
                }}
              />
            ))}
          </>
        )}

        {/* Timeline section */}
        <SectionLabel
          dotColor="var(--text-ghost)"
          label="Timeline"
        />

        {timeline.map((event) => {
          if (event.type === "status") {
            return (
              <StatusEvent
                key={event.key}
                login={event.login}
                action={event.action}
                time={event.time}
                dotColor={event.dotColor}
                actionColor={event.actionColor}
              />
            );
          }
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
              prNumber={prNumber}
              onClick={() => onReviewClick(event.login)}
              minimized={minimizedSet.has(event.commentId)}
              onToggleMinimized={() => toggleMinimized(event.commentId)}
              reactions={event.reactions}
            />
          );
        })}

        {/* Resolved collapsed */}
        {resolvedCount > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowResolved(!showResolved)}
              className="text-text-ghost hover:text-text-tertiary flex w-full cursor-pointer items-center gap-[5px] select-none"
              style={{ padding: "6px 0", fontSize: "11px" }}
            >
              {showResolved ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {resolvedCount} resolved thread{resolvedCount > 1 ? "s" : ""}
            </button>
            {showResolved &&
              resolvedThreads.map((thread) => (
                <UnresolvedThreadItem
                  key={thread.id}
                  thread={thread}
                  onClick={() => {
                    if (thread.comments[0]) {
                      onReviewClick(thread.comments[0].author.login);
                    }
                  }}
                />
              ))}
          </>
        )}

        {/* Empty state */}
        {timeline.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8">
            <p className="text-text-tertiary text-xs">No conversation yet</p>
          </div>
        )}
      </div>

      {/* Comment composer */}
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

type TimelineEvent = StatusTimelineEvent | ContentTimelineEvent;

function buildTimeline(
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>,
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>,
  isBot: (login: string) => boolean,
  issueCommentReactions?: Record<string, GhReactionGroup[]>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Reviews become status events
  for (const review of reviews) {
    const state = review.state;
    let action = "reviewed";
    let dotColor = "var(--text-ghost)";
    let actionColor: string | undefined;

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
      time: new Date(review.submittedAt),
      dotColor,
      actionColor,
    });
  }

  // Issue comments become content events
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

  // Sort chronologically
  events.sort((a, b) => a.time.getTime() - b.time.getTime());

  return events;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ dotColor, label }: { dotColor: string; label: string }) {
  return (
    <div
      className="text-text-tertiary flex items-center gap-[5px] text-[10px] font-semibold tracking-[0.06em] uppercase"
      style={{ padding: "4px 0 6px" }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: dotColor }}
      />
      {label}
    </div>
  );
}

function StatusEvent({
  login,
  action,
  time,
  dotColor,
  actionColor,
}: {
  login: string;
  action: string;
  time: Date;
  dotColor: string;
  actionColor?: string;
}) {
  return (
    <div
      className="border-border-subtle border-b"
      style={{ padding: "4px 0" }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{ marginBottom: 0 }}
      >
        <span
          className="shrink-0 rounded-full"
          style={{ width: "6px", height: "6px", background: dotColor }}
        />
        <span className="text-text-tertiary text-[10px] font-[450]">{login}</span>
        <span
          className="text-[10px]"
          style={{ color: actionColor ?? "var(--text-tertiary)" }}
        >
          {action}
        </span>
        <span className="text-text-ghost ml-auto font-mono text-[9px]">{relativeTime(time)}</span>
      </div>
    </div>
  );
}

function ContentEvent({
  commentId,
  login,
  action,
  time,
  body,
  filePath,
  repo,
  isBot: isBotUser,
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
  prNumber: number;
  onClick: () => void;
  minimized: boolean;
  onToggleMinimized: () => void;
  reactions?: GhReactionGroup[];
}) {
  const { cwd } = useWorkspace();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const severity = isBotUser ? parseBotSeverity(body) : null;

  return (
    <div
      className="border-border-subtle border-b"
      style={{ padding: isBotUser ? "8px 0 8px 4px" : "8px 0" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Header */}
      <div className="mb-[3px] flex items-center gap-1.5">
        <GitHubAvatar
          login={login}
          size={18}
          className={
            isBotUser ? "border-border-accent bg-accent-muted border" : "border-border border"
          }
        />
        <span
          className="cursor-pointer text-xs font-medium"
          style={{ color: isBotUser ? "var(--accent-text)" : "var(--text-primary)" }}
          onClick={onClick}
        >
          {login}
        </span>
        {isBotUser && (
          <span
            style={{
              fontSize: "8px",
              fontWeight: 600,
              padding: "0 3px",
              borderRadius: "2px",
              background: "var(--accent-muted)",
              color: "var(--accent-text)",
              border: "1px solid var(--border-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Bot
          </span>
        )}
        {severity && (
          <span
            style={{
              fontSize: "8px",
              fontWeight: 700,
              padding: "0 3px",
              borderRadius: "2px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              background: severity.bg,
              color: severity.color,
            }}
          >
            {severity.label}
          </span>
        )}
        <span className="text-text-tertiary text-[11px]">{action}</span>
        <span className="text-text-tertiary ml-auto font-mono text-[10px]">
          {relativeTime(time)}
        </span>
        {/* Minimize toggle */}
        <button
          type="button"
          onClick={onToggleMinimized}
          className="text-text-ghost hover:text-text-primary cursor-pointer rounded-sm p-0.5 transition-colors"
          title={minimized ? "Expand" : "Minimize"}
        >
          {minimized ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* Body — hidden when minimized */}
      {!minimized && (
        <>
          {filePath && (
            <div
              className="text-info cursor-pointer font-mono text-[10px] hover:underline"
              style={{ paddingLeft: "24px", marginTop: "2px" }}
              onClick={onClick}
            >
              {filePath}
            </div>
          )}
          <div
            className="text-text-secondary text-xs leading-[1.5]"
            style={{ paddingLeft: "24px" }}
          >
            <MarkdownBody
              content={body}
              repo={repo}
            />
          </div>
          {/* Reactions */}
          <div style={{ paddingLeft: "24px", marginTop: "4px" }}>
            <ReactionBar
              reactions={reactions ?? []}
              subjectId={commentId}
              prNumber={prNumber}
            />
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ConvoContextMenu
          commentId={commentId}
          body={body}
          prNumber={prNumber}
          cwd={cwd}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu for conversation panel comments
// ---------------------------------------------------------------------------

function ConvoContextMenu({
  commentId,
  body,
  prNumber,
  cwd,
  position,
  onClose,
}: {
  commentId: string;
  body: string;
  prNumber: number;
  cwd: string;
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

  // Register global listeners for click-outside and Escape
  useEffect(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClick, handleEscape]);

  const repoSlug = cwd.split("/").slice(-2).join("/");
  const commentUrl = `https://github.com/${repoSlug}/pull/${prNumber}#issuecomment-${commentId}`;

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

function UnresolvedThreadItem({
  thread,
  onClick,
}: {
  thread: GhReviewThread;
  onClick: () => void;
}) {
  const firstComment = thread.comments[0];
  if (!firstComment) {
    return null;
  }

  const preview =
    firstComment.body.length > 120 ? `${firstComment.body.slice(0, 120)}...` : firstComment.body;

  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border-subtle hover:bg-bg-raised w-full cursor-pointer border-b text-left"
      style={{ padding: "6px 0" }}
    >
      <div className="flex items-center gap-1.5">
        <MessageSquare
          size={10}
          className={thread.isResolved ? "text-success" : "text-warning"}
        />
        <span className="text-text-tertiary text-[10px] font-[450]">
          {firstComment.author.login}
        </span>
        {thread.path && (
          <span className="text-text-ghost truncate font-mono text-[9px]">{thread.path}</span>
        )}
      </div>
      <p className="text-text-secondary mt-0.5 truncate text-[11px] leading-[1.4]">{preview}</p>
    </button>
  );
}

function parseBotSeverity(body: string): { label: string; bg: string; color: string } | null {
  const lower = body.toLowerCase();
  if (lower.includes("[critical]") || lower.includes("**critical") || lower.includes("🔴")) {
    return { label: "Critical", bg: "var(--danger-muted)", color: "var(--danger)" };
  }
  if (lower.includes("[suggestion]") || lower.includes("**suggestion")) {
    return { label: "Suggestion", bg: "var(--warning-muted)", color: "var(--warning)" };
  }
  if (lower.includes("[nitpick]") || lower.includes("**nitpick") || lower.includes("nit:")) {
    return { label: "Nitpick", bg: "var(--bg-raised)", color: "var(--text-tertiary)" };
  }
  return null;
}

function PanelComposer({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const [body, setBody] = useState("");

  const commentMutation = useMutation({
    mutationFn: (args: { cwd: string; prNumber: number; body: string }) => ipc("pr.comment", args),
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
      style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}
    >
      <MentionTextarea
        value={body}
        onChange={setBody}
        placeholder="Leave a comment..."
        rows={1}
        prNumber={prNumber}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            commentMutation.mutate({ cwd, prNumber, body: body.trim() });
          }
        }}
        textareaClassName="bg-bg-raised border-border text-text-primary placeholder:text-text-ghost focus:border-border-strong w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none min-h-[32px]"
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
