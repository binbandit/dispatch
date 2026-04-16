import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Shared job/check row — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Single visual vocabulary for both workflow jobs and PR checks. Collapsed
 * shows a one-line summary; expanded reveals caller-provided content
 * (typically a LogViewer whose sections are the per-step breakdown).
 */

interface JobRowProps {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  autoExpandOnFailure?: boolean;
  expandable?: boolean;
}

export function JobRow({
  name,
  status,
  conclusion,
  startedAt,
  completedAt,
  actions,
  children,
  autoExpandOnFailure = true,
  expandable = true,
}: JobRowProps) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = resolveStatusIcon(conclusion, status);

  const [prevConclusion, setPrevConclusion] = useState(conclusion);
  if (conclusion !== prevConclusion) {
    setPrevConclusion(conclusion);
    if (expandable && autoExpandOnFailure && isWorkflowFailure(conclusion)) {
      setExpanded(true);
    }
  }

  const isExpanded = expandable && expanded;

  return (
    <div className="border-border-subtle border-b">
      <div
        className={`group flex w-full items-center gap-2 px-4 py-2 ${
          isExpanded ? "bg-bg-raised" : expandable ? "hover:bg-bg-raised" : ""
        }`}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {isExpanded ? (
              <ChevronDown
                size={12}
                className="text-text-tertiary shrink-0"
              />
            ) : (
              <ChevronRight
                size={12}
                className="text-text-tertiary shrink-0"
              />
            )}
            <statusIcon.icon
              size={14}
              className={`shrink-0 ${statusIcon.color} ${statusIcon.spin ? "animate-spin" : ""}`}
            />
            <span className="text-text-primary min-w-0 flex-1 truncate text-xs font-medium">
              {name}
            </span>
            <span className="text-text-tertiary shrink-0 font-mono text-[10px]">
              {computeDuration(startedAt, completedAt, status)}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-[18px]">
            <statusIcon.icon
              size={14}
              className={`shrink-0 ${statusIcon.color} ${statusIcon.spin ? "animate-spin" : ""}`}
            />
            <span className="text-text-primary min-w-0 flex-1 truncate text-xs font-medium">
              {name}
            </span>
            <span className="text-text-tertiary shrink-0 font-mono text-[10px]">
              {computeDuration(startedAt, completedAt, status)}
            </span>
          </div>
        )}
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {isExpanded && children && <div className="bg-bg-root px-4 pt-1 pb-2 pl-10">{children}</div>}
    </div>
  );
}

export function resolveStatusIcon(conclusion: string | null, status?: string) {
  if (conclusion === "success") {
    return { icon: CheckCircle2, color: "text-success", spin: false };
  }
  if (conclusion === "failure" || conclusion === "error") {
    return { icon: XCircle, color: "text-destructive", spin: false };
  }
  if (conclusion === "cancelled") {
    return { icon: XCircle, color: "text-text-tertiary", spin: false };
  }
  if (conclusion === "skipped") {
    return { icon: Clock, color: "text-text-tertiary", spin: false };
  }
  if (status?.toLowerCase() === "in_progress") {
    return { icon: Loader2, color: "text-warning", spin: true };
  }
  return { icon: Clock, color: "text-text-tertiary", spin: false };
}

export function isWorkflowFailure(conclusion: string | null): boolean {
  return conclusion === "failure" || conclusion === "error";
}

function computeDuration(
  startedAt: string | null,
  completedAt: string | null,
  status?: string,
): string {
  const running = status?.toLowerCase() === "in_progress";
  if (startedAt && !completedAt) {
    return running ? "Running…" : "—";
  }
  if (!startedAt || !completedAt) {
    return "—";
  }
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();
  const ms = endMs - startMs;
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
