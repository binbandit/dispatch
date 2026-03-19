import { relativeTime } from "@/shared/format";

/**
 * Inline comment display — renders existing PR review comments in the diff.
 *
 * Renders inside a `<td colSpan={3}>` in the diff table as a card.
 * Matches the comment composer's visual treatment (card with margin).
 */

export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  user: { login: string; avatar_url?: string };
  created_at: string;
  in_reply_to_id?: number;
}

interface InlineCommentProps {
  comments: ReviewComment[];
}

export function InlineComment({ comments }: InlineCommentProps) {
  // Group into threads: root comments and their replies
  const roots = comments.filter((c) => !c.in_reply_to_id);
  const replies = comments.filter((c) => !!c.in_reply_to_id);

  return (
    <div className="border-border bg-bg-surface/60 mx-3 my-1.5 max-w-xl overflow-hidden rounded-lg border shadow-sm">
      {roots.map((root, i) => {
        const threadReplies = replies.filter((r) => r.in_reply_to_id === root.id);
        return (
          <div key={root.id}>
            {i > 0 && <div className="border-border border-t" />}
            <CommentBody comment={root} />
            {threadReplies.map((reply) => (
              <div
                key={reply.id}
                className="border-border-subtle border-t"
              >
                <CommentBody comment={reply} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CommentBody({ comment }: { comment: ReviewComment }) {
  const initial = comment.user.login[0]?.toUpperCase() ?? "?";

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Avatar */}
        {comment.user.avatar_url ? (
          <img
            src={`${comment.user.avatar_url}&s=32`}
            alt={comment.user.login}
            className="border-border-strong h-5 w-5 shrink-0 rounded-full border object-cover"
          />
        ) : (
          <div
            className="text-bg-root flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
            style={{ background: "linear-gradient(135deg, var(--primary), #7c5a2a)" }}
          >
            {initial}
          </div>
        )}
        <span className="text-text-primary text-[11px] font-medium">{comment.user.login}</span>
        <span className="text-text-tertiary font-mono text-[10px]">
          {relativeTime(new Date(comment.created_at))}
        </span>
      </div>
      <p className="text-text-secondary mt-1.5 text-xs leading-relaxed whitespace-pre-wrap">
        {comment.body}
      </p>
    </div>
  );
}
