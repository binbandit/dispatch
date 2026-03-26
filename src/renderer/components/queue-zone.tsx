import type { GhPrListItemCore } from "@/shared/ipc";

import { relativeTime } from "@/shared/format";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";

import { formatAuthorName, useDisplayNameFormat } from "../hooks/use-display-name";

/**
 * Queue zone — PR-REVIEW-REDESIGN.md § Queue zone
 *
 * Top of the review sidebar. Shows back arrow, review count,
 * and compact list of queued PRs.
 */

interface QueueZoneProps {
  queuePrs: GhPrListItemCore[];
  activePrNumber: number;
  onBack: () => void;
  onSelectPr: (prNumber: number) => void;
  hideWhenEmpty?: boolean;
}

function resolveQueueDot(pr: GhPrListItemCore): { dotColor: string; pulse: boolean; label: string } {
  if (pr.state === "CLOSED") {
    return { dotColor: "bg-destructive", pulse: false, label: "Closed" };
  }
  if (pr.state === "MERGED") {
    return { dotColor: "bg-purple", pulse: false, label: "Merged" };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { dotColor: "bg-warning", pulse: false, label: "Changes requested" };
  }
  if (!pr.isDraft && pr.reviewDecision === "APPROVED") {
    return { dotColor: "bg-success", pulse: false, label: "Approved" };
  }
  if (pr.isDraft) {
    return { dotColor: "bg-text-ghost", pulse: false, label: "Draft" };
  }
  return { dotColor: "bg-purple", pulse: false, label: "Review requested" };
}

export function QueueZone({ queuePrs, activePrNumber, onBack, onSelectPr }: QueueZoneProps) {
  const nameFormat = useDisplayNameFormat();
  const hasQueue = queuePrs.length > 0;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fire when active PR changes
  const activeRef = useCallback(
    (node: HTMLButtonElement | null) => {
      node?.scrollIntoView({ block: "nearest" });
    },
    [activePrNumber],
  );

  return (
    <div className="border-border shrink-0 border-b">
      {/* Header — always show back button */}
      <div
        className="flex items-center gap-1.5"
        style={{ padding: "5px 10px 3px" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex cursor-pointer items-center gap-0.5 rounded-sm px-1 py-0.5 text-[11px] select-none"
        >
          <ArrowLeft size={12} />
          Queue
        </button>
        {hasQueue && (
          <>
            <span className="flex-1" />
            <span className="text-text-ghost text-[10px] font-semibold tracking-[0.06em] uppercase">
              {queuePrs.length} to review
            </span>
          </>
        )}
      </div>

      {/* Queue list — hidden when empty and hideWhenEmpty is set */}
      {hasQueue && (
        <div className="flex max-h-[160px] flex-col overflow-y-auto">
          {queuePrs.map((pr) => {
            const isActive = pr.number === activePrNumber;
            const dot = resolveQueueDot(pr);

            return (
              <button
                key={pr.number}
                ref={isActive ? activeRef : undefined}
                type="button"
                onClick={() => onSelectPr(pr.number)}
                className={`flex w-full cursor-pointer items-start gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
                  isActive
                    ? "border-l-primary bg-accent-muted"
                    : "hover:bg-bg-raised border-l-transparent"
                }`}
              >
                {/* Status dot */}
                <div
                  className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${dot.dotColor} ${dot.pulse ? "animate-pulse" : ""}`}
                  title={dot.label}
                />
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="text-text-primary truncate text-[11px] font-medium">{pr.title}</div>
                  <div className="text-text-tertiary mt-0.5 flex items-center gap-1 font-mono text-[10px]">
                    <span>#{pr.number}</span>
                    <span className="text-text-ghost">&middot;</span>
                    <span className="truncate">{formatAuthorName(pr.author, nameFormat)}</span>
                  </div>
                </div>
                {/* Time */}
                <span className="text-text-ghost mt-0.5 shrink-0 font-mono text-[10px]">
                  {relativeTime(new Date(pr.updatedAt))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
