import type { GhPrListItemCore } from "@/shared/ipc";

import { ArrowLeft } from "lucide-react";

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

export function QueueZone({ queuePrs, activePrNumber, onBack, onSelectPr }: QueueZoneProps) {
  const hasQueue = queuePrs.length > 0;

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
        <div className="flex max-h-[120px] flex-col overflow-y-auto px-1 pb-1">
          {queuePrs.map((pr) => {
            const isActive = pr.number === activePrNumber;
            const dotColor =
              pr.reviewDecision === "APPROVED"
                ? "bg-success"
                : pr.isDraft
                  ? "bg-warning"
                  : "bg-purple";

            return (
              <button
                key={pr.number}
                type="button"
                onClick={() => onSelectPr(pr.number)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-sm border-l-2 text-left text-[11px] select-none ${
                  isActive
                    ? "bg-accent-muted border-l-primary"
                    : "hover:bg-bg-raised border-l-transparent"
                }`}
                style={{ padding: "3px 8px" }}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
                <span
                  className={`min-w-0 flex-1 truncate ${
                    isActive ? "text-text-primary font-medium" : "text-text-secondary font-[450]"
                  }`}
                >
                  {pr.title}
                </span>
                <span
                  className={`shrink-0 font-mono text-[10px] ${
                    isActive ? "text-accent-text" : "text-text-ghost"
                  }`}
                >
                  #{pr.number}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
