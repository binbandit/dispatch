import type { ReviewThreadState } from "@/renderer/lib/review/review-comments";
import type { GhReactionGroup } from "@/shared/ipc";

import { BotCommentGroup } from "@/renderer/components/review/comments/bot-comment-group";
import { CommentThread } from "@/renderer/components/review/comments/comment-thread";
import { useBotSettings } from "@/renderer/hooks/preferences/use-bot-settings";
import { useMinimizedComments } from "@/renderer/hooks/review/use-minimized-comments";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";

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
  currentUserLogin?: string | null;
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
  currentUserLogin,
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
    <div className="border-border mx-4 my-3 max-w-[52rem] overflow-hidden rounded-[10px] border bg-[linear-gradient(180deg,var(--comment-card-from),var(--comment-card-to))] shadow-[var(--comment-card-shadow)]">
      {humanEntries.map((root, i) => {
        const threadReplies = replies.filter((r) => r.in_reply_to_id === root.id);
        return (
          <CommentThread
            key={root.id}
            root={root}
            replies={threadReplies}
            prNumber={prNumber}
            currentUserLogin={currentUserLogin}
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
            currentUserLogin={currentUserLogin}
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
