import { toastManager } from "@/components/ui/toast";
import { relativeTime } from "@/shared/format";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";
import { MarkdownBody } from "./markdown-body";

/**
 * Conversation tab — PR-REVIEW-REDESIGN.md § Side Panel → Conversation tab
 *
 * Timeline of events: unresolved section at top, then chronological timeline
 * of status events (compact) and content events (full comments).
 * Comment composer at bottom.
 */

// Known bot patterns
const BOT_PATTERNS = [
  /\[bot\]$/i,
  /-bot$/i,
  /^dependabot$/i,
  /^github-actions$/i,
  /^codecov$/i,
  /^coderabbit$/i,
];
function isBot(login: string): boolean {
  return BOT_PATTERNS.some((p) => p.test(login));
}

interface ConversationTabProps {
  prNumber: number;
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>;
  repo: string;
  onReviewClick: (login: string) => void;
}

export function ConversationTab({
  prNumber,
  reviews,
  issueComments,
  repo,
  onReviewClick,
}: ConversationTabProps) {
  // Build a unified timeline from reviews (status events) and issue comments (content events)
  const timeline = buildTimeline(reviews, issueComments);

  // Separate unresolved items (for now, treat all inline comments as potentially unresolved)
  // In the real app this would check thread resolution state
  const unresolvedCount = 0; // TODO: wire to actual unresolved thread count
  const resolvedCount = 0;

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
            {/* TODO: render unresolved thread items */}
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
              login={event.login}
              action={event.action}
              time={event.time}
              body={event.body}
              filePath={event.filePath}
              repo={repo}
              isBot={event.isBot}
              onClick={() => onReviewClick(event.login)}
            />
          );
        })}

        {/* Resolved collapsed */}
        {resolvedCount > 0 && (
          <div
            className="text-text-ghost hover:text-text-tertiary flex cursor-pointer items-center gap-[5px] select-none"
            style={{ padding: "6px 0", fontSize: "11px" }}
          >
            <ChevronRight size={11} />
            {resolvedCount} resolved thread{resolvedCount > 1 ? "s" : ""}
          </div>
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
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  isBot: boolean;
}

type TimelineEvent = StatusTimelineEvent | ContentTimelineEvent;

function buildTimeline(
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>,
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>,
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
      login: comment.author.login,
      action: "commented",
      time: new Date(comment.createdAt),
      body: comment.body,
      isBot: isBot(comment.author.login),
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
  login,
  action,
  time,
  body,
  filePath,
  repo,
  isBot: isBotUser,
  onClick,
}: {
  login: string;
  action: string;
  time: Date;
  body: string;
  filePath?: string;
  repo: string;
  isBot: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="border-border-subtle cursor-pointer border-b"
      style={{ padding: isBotUser ? "8px 0 8px 4px" : "8px 0" }}
      onClick={onClick}
    >
      <div className="mb-[3px] flex items-center gap-1.5">
        <GitHubAvatar
          login={login}
          size={18}
          className={
            isBotUser ? "border-border-accent bg-accent-muted border" : "border-border border"
          }
        />
        <span
          className="text-xs font-medium"
          style={{ color: isBotUser ? "var(--accent-text)" : "var(--text-primary)" }}
        >
          {login}
        </span>
        {isBotUser && (
          <span
            className="rounded-xs text-[8px] font-semibold tracking-[0.04em] uppercase"
            style={{
              padding: "0 3px",
              background: "var(--accent-muted)",
              color: "var(--accent-text)",
              border: "1px solid var(--border-accent)",
            }}
          >
            Bot
          </span>
        )}
        <span className="text-text-tertiary text-[11px]">{action}</span>
        <span className="text-text-tertiary ml-auto font-mono text-[10px]">
          {relativeTime(time)}
        </span>
      </div>
      {filePath && (
        <div
          className="text-info cursor-pointer font-mono text-[10px] hover:underline"
          style={{ paddingLeft: "24px", marginTop: "2px" }}
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
    </div>
  );
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
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            commentMutation.mutate({ cwd, prNumber, body: body.trim() });
          }
        }}
        className="text-text-primary placeholder:text-text-ghost focus:border-border-strong w-full resize-none rounded-lg outline-none"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          padding: "6px 10px",
          fontSize: "12px",
          minHeight: "32px",
        }}
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
