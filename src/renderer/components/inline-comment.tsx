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

import { ipc } from "../lib/ipc";
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

export function InlineComment({ comments, prNumber }: InlineCommentProps) {
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
          />
        );
      })}

      {botRoots.length > 0 && (
        <>
          {humanRoots.length > 0 && <div className="border-border border-t" />}
          <BotCommentGroup comments={botRoots} />
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
}: {
  root: ReviewComment;
  replies: ReviewComment[];
  prNumber?: number;
  showBorder: boolean;
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
          />
          {replies.map((reply) => (
            <div
              key={reply.id}
              className="border-border-subtle border-t"
            >
              <CommentBody
                comment={reply}
                onReply={() => setShowReply(true)}
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

function BotCommentGroup({ comments }: { comments: ReviewComment[] }) {
  const [expanded, setExpanded] = useState(false);
  const botNames = [...new Set(comments.map((c) => c.user.login))];

  return (
    <div className="border-dashed">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-text-tertiary hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px]"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="opacity-60">
          {comments.length} bot comment{comments.length > 1 ? "s" : ""} from {botNames.join(", ")}
        </span>
      </button>
      {expanded &&
        comments.map((comment) => (
          <div
            key={comment.id}
            className="border-border-subtle border-t"
          >
            <CommentBody comment={comment} />
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
}: {
  comment: ReviewComment;
  position: { x: number; y: number };
  onClose: () => void;
}) {
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
        icon={<ExternalLink size={12} />}
        label="Copy link"
        onClick={() => {
          // GitHub review comment URL pattern
          const url = `https://github.com/${comment.path}#discussion_r${comment.id}`;
          navigator.clipboard.writeText(url);
          toastManager.add({ title: "Link copied", type: "success" });
          onClose();
        }}
      />
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
}: {
  comment: ReviewComment;
  isRoot?: boolean;
  onReply?: () => void;
}) {
  const isBotUser = isBot(comment.user.login);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { bodyParts, suggestions } = useMemo(() => parseSuggestions(comment.body), [comment.body]);

  return (
    <div
      className={`px-3 py-2.5 ${isBotUser ? "opacity-70" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex items-center gap-2">
        <GitHubAvatar
          login={comment.user.login}
          size={20}
        />
        <span className="text-text-primary text-[11px] font-medium">{comment.user.login}</span>
        {isBotUser && (
          <span className="bg-bg-raised text-text-ghost rounded-sm px-1 text-[9px]">bot</span>
        )}
        <span className="text-text-tertiary font-mono text-[10px]">
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
        </div>
      </div>

      <div className="mt-1.5">
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

      {/* Context menu */}
      {contextMenu && (
        <CommentContextMenu
          comment={comment}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
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
  return (
    <div className="border-success/30 bg-diff-add-bg/30 my-2 overflow-hidden rounded-md border">
      <div className="border-success/20 flex items-center gap-1.5 border-b px-3 py-1.5">
        <Check
          size={11}
          className="text-success"
        />
        <span className="text-success text-[10px] font-medium">Suggested change</span>
      </div>
      <pre className="text-text-primary overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {suggestion}
      </pre>
    </div>
  );
}
