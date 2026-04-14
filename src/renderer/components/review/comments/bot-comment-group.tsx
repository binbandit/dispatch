import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";
import type { GhReactionGroup } from "@/shared/ipc";

import { CommentBody } from "@/renderer/components/review/comments/comment-body";
import { InlineMetaBadge } from "@/renderer/components/review/comments/inline-meta-badge";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

export function BotCommentGroup({
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
