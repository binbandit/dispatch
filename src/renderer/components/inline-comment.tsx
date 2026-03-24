import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
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
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useMinimizedComments } from "../hooks/use-minimized-comments";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";
import { MarkdownBody } from "./markdown-body";
import { MentionTextarea } from "./mention-textarea";

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
  user: { login: string; avatar_url?: string };
  created_at: string;
  in_reply_to_id?: number;
  node_id?: string;
}

interface InlineCommentProps {
  comments: ReviewComment[];
  prNumber?: number;
  repo?: string;
}

// Known bot patterns
const BOT_PATTERNS = [
  /\[bot\]$/i,
  /-bot$/i,
  /^dependabot$/i,
  /^renovate$/i,
  /^codecov$/i,
  /^vercel$/i,
  /^github-actions$/i,
];

function isBot(login: string): boolean {
  return BOT_PATTERNS.some((p) => p.test(login));
}

export function InlineComment({ comments, prNumber, repo }: InlineCommentProps) {
  const { cwd } = useWorkspace();
  const repoKey = repo || cwd;
  const { minimizedSet, toggleMinimized } = useMinimizedComments(repoKey, prNumber ?? 0);

  const roots = comments.filter((c) => !c.in_reply_to_id);
  const replies = comments.filter((c) => !!c.in_reply_to_id);

  const botRoots = roots.filter((c) => isBot(c.user.login));
  const humanRoots = roots.filter((c) => !isBot(c.user.login));

  return (
    <div className="border-border bg-bg-surface/60 mx-3 my-1.5 max-w-xl overflow-hidden rounded-lg border shadow-sm">
      {humanRoots.map((root, i) => {
        const threadReplies = replies.filter((r) => r.in_reply_to_id === root.id);
        return (
          <CommentThread
            key={root.id}
            root={root}
            replies={threadReplies}
            prNumber={prNumber}
            showBorder={i > 0}
            minimizedSet={minimizedSet}
            toggleMinimized={toggleMinimized}
          />
        );
      })}

      {botRoots.length > 0 && (
        <>
          {humanRoots.length > 0 && <div className="border-border border-t" />}
          <BotCommentGroup
            comments={botRoots}
            minimizedSet={minimizedSet}
            toggleMinimized={toggleMinimized}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment thread (root + replies, collapsible, with reply input)
// ---------------------------------------------------------------------------

function CommentThread({
  root,
  replies,
  prNumber,
  showBorder,
  minimizedSet,
  toggleMinimized,
}: {
  root: ReviewComment;
  replies: ReviewComment[];
  prNumber?: number;
  showBorder: boolean;
  minimizedSet: Set<string>;
  toggleMinimized: (commentId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const totalCount = 1 + replies.length;

  return (
    <div>
      {showBorder && <div className="border-border border-t" />}

      {/* Collapse bar — shows when thread has replies */}
      {replies.length > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-text-ghost hover:bg-bg-raised flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-[10px]"
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          {collapsed ? `${totalCount} comments (collapsed)` : `${totalCount} comments`}
        </button>
      )}

      {!collapsed && (
        <>
          <CommentBody
            comment={root}
            isRoot
            onReply={() => setShowReply(true)}
            prNumber={prNumber}
            minimized={minimizedSet.has(String(root.id))}
            onToggleMinimized={() => toggleMinimized(String(root.id))}
          />
          {replies.map((reply) => (
            <div
              key={reply.id}
              className="border-border-subtle border-t"
            >
              <CommentBody
                comment={reply}
                onReply={() => setShowReply(true)}
                prNumber={prNumber}
                minimized={minimizedSet.has(String(reply.id))}
                onToggleMinimized={() => toggleMinimized(String(reply.id))}
              />
            </div>
          ))}
        </>
      )}

      {/* Reply input */}
      {showReply && prNumber && (
        <div className="border-border border-t">
          <ReplyComposer
            prNumber={prNumber}
            commentId={root.id}
            onClose={() => setShowReply(false)}
          />
        </div>
      )}

      {/* Quick reply button (when not already replying) */}
      {!showReply && !collapsed && prNumber && (
        <div className="border-border border-t px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowReply(true)}
            className="text-text-tertiary hover:text-text-primary flex cursor-pointer items-center gap-1 text-[10px]"
          >
            <Reply size={10} />
            Reply
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
  const { cwd } = useWorkspace();
  const [body, setBody] = useState("");

  const replyMutation = useMutation({
    mutationFn: (args: { cwd: string; prNumber: number; commentId: number; body: string }) =>
      ipc("pr.replyToComment", args),
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
    <div className="px-3 py-2">
      <MentionTextarea
        value={body}
        onChange={setBody}
        placeholder="Write a reply..."
        rows={2}
        prNumber={prNumber}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            replyMutation.mutate({ cwd, prNumber, commentId, body: body.trim() });
          }
          if (e.key === "Escape") {
            onClose();
          }
        }}
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-accent-hover"
          disabled={!body.trim() || replyMutation.isPending}
          onClick={() => replyMutation.mutate({ cwd, prNumber, commentId, body: body.trim() })}
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
  minimizedSet,
  toggleMinimized,
}: {
  comments: ReviewComment[];
  minimizedSet: Set<string>;
  toggleMinimized: (commentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const botNames = [...new Set(comments.map((c) => c.user.login))];

  return (
    <div
      className="border-t border-b"
      style={{
        borderColor: "var(--border)",
        borderLeft: "2px solid var(--accent)",
        background: "rgba(212,136,58,0.03)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-text-secondary hover:bg-bg-raised/50 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px]"
      >
        {/* Bot avatar icon */}
        <span
          className="bg-accent-muted border-border-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[8px]"
          style={{ color: "var(--accent-text)" }}
        >
          ✦
        </span>
        <span className="text-accent-text font-medium">{botNames.join(", ")}</span>
        <span className="bg-accent-muted text-accent-text border-border-accent rounded-xs border px-1 text-[9px] font-semibold tracking-[0.04em] uppercase">
          Bot
        </span>
        <span className="text-text-tertiary">
          {comments.length} comment{comments.length > 1 ? "s" : ""}
        </span>
        <span className="ml-auto">
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
              minimized={minimizedSet.has(String(comment.id))}
              onToggleMinimized={() => toggleMinimized(String(comment.id))}
            />
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread resolution
// ---------------------------------------------------------------------------

function ThreadResolveButton({ comment }: { comment: ReviewComment }) {
  const { cwd } = useWorkspace();
  const [resolved, setResolved] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: () => {
      if (!comment.node_id) {
        return Promise.reject(new Error("No thread ID"));
      }
      return resolved
        ? ipc("pr.unresolveThread", { cwd, threadId: comment.node_id })
        : ipc("pr.resolveThread", { cwd, threadId: comment.node_id });
    },
    onSuccess: () => {
      setResolved(!resolved);
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
    },
    onError: () => {
      toastManager.add({ title: "Failed to update thread", type: "error" });
    },
  });

  if (!comment.node_id) {
    return null;
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-text-tertiary hover:text-text-primary gap-1 text-[10px]"
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
  const { cwd } = useWorkspace();
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

  // Register global listeners
  useState(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  });

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
          const repoSlug = cwd.split("/").slice(-2).join("/");
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
          const repoSlug = cwd.split("/").slice(-2).join("/");
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
}: {
  comment: ReviewComment;
  isRoot?: boolean;
  onReply?: () => void;
  prNumber?: number;
  minimized: boolean;
  onToggleMinimized: () => void;
}) {
  const isBotUser = isBot(comment.user.login);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { bodyParts, suggestions } = useMemo(() => parseSuggestions(comment.body), [comment.body]);

  // Parse severity from bot comments (look for [Critical], [Suggestion], [Nitpick] patterns)
  const severity = isBotUser ? parseSeverity(comment.body) : null;

  return (
    <div
      style={
        isBotUser
          ? {
              background: "rgba(212,136,58,0.03)",
              borderLeft: "2px solid var(--accent)",
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              padding: "8px 12px 8px 66px",
            }
          : { padding: "8px 12px 8px 68px" }
      }
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Header */}
      <div className="mb-1 flex items-center gap-1.5">
        {isBotUser ? (
          /* Bot avatar — accent sparkle icon */
          <span
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{
              width: "20px",
              height: "20px",
              background: "var(--accent-muted)",
              border: "1px solid var(--accent)",
              fontSize: "8px",
              fontWeight: 600,
              color: "var(--accent-text)",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            </svg>
          </span>
        ) : (
          <GitHubAvatar
            login={comment.user.login}
            size={18}
            avatarUrl={comment.user.avatar_url}
          />
        )}
        <span
          className="text-xs font-medium"
          style={{ color: isBotUser ? "var(--accent-text)" : "var(--text-primary)" }}
        >
          {comment.user.login}
        </span>
        {isBotUser && (
          <span
            style={{
              fontSize: "9px",
              fontWeight: 600,
              padding: "0 4px",
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
              fontSize: "9px",
              fontWeight: 700,
              padding: "0 5px",
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
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {relativeTime(new Date(comment.created_at))}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="text-text-ghost hover:text-text-primary cursor-pointer rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
              title="Reply"
            >
              <Reply size={12} />
            </button>
          )}
          {isRoot && <ThreadResolveButton comment={comment} />}
          {/* Minimize toggle */}
          <button
            type="button"
            onClick={onToggleMinimized}
            className="text-text-ghost hover:text-text-primary cursor-pointer rounded-sm p-0.5 transition-colors"
            title={minimized ? "Expand comment" : "Minimize comment"}
          >
            {minimized ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Body — hidden when minimized */}
      {!minimized && (
        <div>
          {bodyParts.map((part, i) => {
            if (part.type === "text") {
              return (
                <MarkdownBody
                  key={`text-${i}`}
                  content={part.content}
                  className="text-xs leading-relaxed"
                />
              );
            }
            return (
              <SuggestionBlock
                key={`suggestion-${i}`}
                suggestion={part.content}
              />
            );
          })}
          {bodyParts.length === 0 && suggestions.length === 0 && (
            <MarkdownBody
              content={comment.body}
              className="text-xs leading-relaxed"
            />
          )}
        </div>
      )}

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

function SuggestionBlock({ suggestion }: { suggestion: string }) {
  // Parse suggestion lines into del/add
  const lines = suggestion.split("\n");

  return (
    <div
      className="my-2 overflow-hidden"
      style={{
        background: "rgba(61,214,140,0.06)",
        border: "1px solid rgba(61,214,140,0.15)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="flex items-center gap-[5px]"
        style={{ padding: "5px 8px", fontSize: "10px", fontWeight: 600, color: "var(--success)" }}
      >
        <Check size={11} />
        Suggested fix
        <button
          type="button"
          className="ml-auto cursor-pointer border-none"
          style={{
            padding: "3px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--success)",
            color: "var(--bg-root)",
            fontSize: "11px",
            fontWeight: 600,
          }}
        >
          Apply
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
            const trimmed = line;
            if (trimmed.startsWith("-")) {
              return (
                <div
                  key={i}
                  style={{ color: "var(--danger)", textDecoration: "line-through", opacity: 0.7 }}
                >
                  {trimmed.slice(1)}
                </div>
              );
            }
            if (trimmed.startsWith("+")) {
              return (
                <div
                  key={i}
                  style={{ color: "var(--success)" }}
                >
                  {trimmed.slice(1)}
                </div>
              );
            }
            return <div key={i}>{line}</div>;
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
