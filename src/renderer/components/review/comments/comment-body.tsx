import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";
import type { ReviewThreadState } from "@/renderer/lib/review/review-comments";
/* eslint-disable import/max-dependencies -- Comment body integrates markdown, suggestions, reactions, context menu, and thread resolution in one row component. */
import type { GhReactionGroup } from "@/shared/ipc";

import { cn } from "@/lib/utils";
import { CommentContextMenu } from "@/renderer/components/review/comments/comment-context-menu";
import { InlineMetaBadge } from "@/renderer/components/review/comments/inline-meta-badge";
import { ReactionBar } from "@/renderer/components/review/comments/reaction-bar";
import {
  SuggestionBlock,
  parseSuggestions,
} from "@/renderer/components/review/comments/suggestion-block";
import { ThreadResolveButton } from "@/renderer/components/review/comments/thread-resolve-button";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { inferLanguage } from "@/renderer/lib/review/highlighter";
import { relativeTime } from "@/shared/format";
import { CheckCircle2, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

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

export function CommentBody({
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
            className="ring-1 ring-[var(--avatar-ring)]"
          />
        )}
      </div>

      <div className="min-w-0">
        {/* Header row toggles minimize on click */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            aria-expanded={!minimized}
            aria-label={
              minimized
                ? `Expand comment from ${comment.user.login}`
                : `Minimize comment from ${comment.user.login}`
            }
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
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
          </button>
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
