import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";
import type { ReviewThreadState } from "@/renderer/lib/review/review-comments";
/* eslint-disable import/max-dependencies -- Thread component integrates replies, collapsing, and resolution in one view. */
import type { GhReactionGroup } from "@/shared/ipc";

import { cn } from "@/lib/utils";
import { CommentBody } from "@/renderer/components/review/comments/comment-body";
import { InlineMetaBadge } from "@/renderer/components/review/comments/inline-meta-badge";
import { ReplyComposer } from "@/renderer/components/review/comments/reply-composer";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { relativeTime } from "@/shared/format";
import { ChevronDown, ChevronRight, Reply } from "lucide-react";
import { useMemo, useState } from "react";

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

export function CommentThread({
  root,
  replies,
  prNumber,
  currentUserLogin,
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
  currentUserLogin?: string | null;
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
  const rootAutoMinimized = shouldAutoCollapseBot(root.user.login) || (isDismissed && !hasReplies);

  return (
    <div
      className={cn(
        "relative",
        showBorder && "border-border-subtle border-t",
        isResolvedThread &&
          "bg-success-muted/50 before:bg-success before:absolute before:inset-y-0 before:left-0 before:w-[2px]",
        isOutdatedThread &&
          !isResolvedThread &&
          "bg-bg-surface before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--text-tertiary)]",
      )}
    >
      {hasReplies &&
        (collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="hover:bg-bg-raised flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left transition-colors"
          >
            <ChevronRight
              size={12}
              className="text-text-ghost mt-0.5 shrink-0"
            />
            <GitHubAvatar
              login={root.user.login}
              size={16}
              avatarUrl={root.user.avatar_url}
              className="ring-1 ring-[var(--avatar-ring)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-text-primary truncate text-[11px] font-medium">
                  {root.user.login}
                </span>
                <span className="text-text-tertiary font-mono text-[10px]">
                  {relativeTime(new Date(root.created_at))}
                </span>
                <InlineMetaBadge className="border-border bg-bg-surface text-text-tertiary">
                  +{replies.length} {replies.length === 1 ? "reply" : "replies"}
                </InlineMetaBadge>
                {isResolvedThread && (
                  <InlineMetaBadge className="border-success/30 bg-success-muted text-success">
                    Resolved
                  </InlineMetaBadge>
                )}
                {isOutdatedThread && !isResolvedThread && (
                  <InlineMetaBadge className="border-border bg-bg-surface text-text-tertiary">
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
              <InlineMetaBadge className="border-success/30 bg-success-muted text-success ml-auto">
                Resolved
              </InlineMetaBadge>
            )}
            {isOutdatedThread && !isResolvedThread && (
              <InlineMetaBadge className="border-border bg-bg-surface text-text-tertiary ml-auto">
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
            canEdit={currentUserLogin !== null && currentUserLogin === root.user.login}
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
                canEdit={currentUserLogin !== null && currentUserLogin === reply.user.login}
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
            className="border-border bg-bg-surface text-text-secondary hover:border-border-strong hover:bg-bg-raised hover:text-text-primary inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors"
          >
            <Reply size={11} />
            Reply to thread
          </button>
        </div>
      )}
    </div>
  );
}
