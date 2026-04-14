/* eslint-disable import/max-dependencies -- This panel intentionally combines run actions, live status, logs, and AI explanation affordances. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { AiFailureExplainer } from "@/renderer/components/review/ai/ai-failure-explainer";
import { LogViewer } from "@/renderer/components/workflows/log-viewer";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";

/**
 * CI/CD Checks panel — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Shows real check run data with 10s polling.
 */

interface ChecksPanelProps {
  prNumber: number;
}

type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled";

function resolveCheckStatus(status: string, conclusion: string | null): CheckStatus {
  if (conclusion === "success") {
    return "success";
  }
  if (conclusion === "failure" || conclusion === "error") {
    return "failure";
  }
  if (conclusion === "cancelled") {
    return "cancelled";
  }
  if (conclusion === "skipped") {
    return "skipped";
  }
  if (status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" || !conclusion) {
    return "pending";
  }
  return "skipped";
}

const STATUS_ICON: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; color: string; spin?: boolean }
> = {
  success: { icon: CheckCircle2, color: "text-success" },
  failure: { icon: XCircle, color: "text-destructive" },
  pending: { icon: Loader2, color: "text-warning", spin: true },
  skipped: { icon: Clock, color: "text-text-tertiary" },
  cancelled: { icon: XCircle, color: "text-text-tertiary" },
};

export function ChecksPanel({ prNumber }: ChecksPanelProps) {
  const { repoTarget, nwo } = useWorkspace();
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const checksQuery = useQuery({
    queryKey: ["checks", "list", nwo, prNumber],
    queryFn: () => ipc("checks.list", { ...repoTarget, prNumber }),
    refetchInterval: 10_000,
  });

  const checks = checksQuery.data ?? [];

  const passCount = checks.filter(
    (c) => resolveCheckStatus(c.status, c.conclusion) === "success",
  ).length;
  const failCount = checks.filter(
    (c) => resolveCheckStatus(c.status, c.conclusion) === "failure",
  ).length;

  if (checksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="text-primary h-4 w-4" />
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="text-text-tertiary px-3 py-4 text-center text-xs">
        No CI checks configured
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-2 px-5 py-2.5">
        <span className="text-success font-mono text-[10px]">{passCount} passed</span>
        {failCount > 0 && (
          <span className="text-destructive font-mono text-[10px]">{failCount} failed</span>
        )}
      </div>

      {/* Check items */}
      <div className="divide-border divide-y">
        {checks.map((check) => {
          const checkStatus = resolveCheckStatus(check.status, check.conclusion);
          const { icon: Icon, color, spin } = STATUS_ICON[checkStatus];
          const isExpanded = expandedCheck === check.name;

          // Extract run ID from detailsUrl for re-run
          const runIdMatch = check.detailsUrl?.match(/\/runs\/(\d+)/);
          const runId = runIdMatch ? Number(runIdMatch[1]) : null;

          return (
            <div key={check.name}>
              <button
                type="button"
                onClick={() => setExpandedCheck(isExpanded ? null : check.name)}
                className={`flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                  isExpanded ? "bg-accent-muted" : "hover:bg-bg-raised"
                }`}
              >
                <Icon
                  size={16}
                  className={`shrink-0 ${color} ${spin ? "animate-spin" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary truncate text-xs font-medium">{check.name}</p>
                  <p className="text-text-tertiary mt-0.5 flex items-center gap-1.5 font-mono text-[10px]">
                    <span>
                      {check.completedAt
                        ? formatDuration(check.startedAt, check.completedAt)
                        : check.startedAt
                          ? "Running…"
                          : check.status}
                    </span>
                    <span className="text-text-ghost">·</span>
                    <span>{checkStatus}</span>
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {checkStatus === "failure" && runId && (
                    <RerunButton
                      repoTarget={repoTarget}
                      runId={runId}
                    />
                  )}
                </div>
              </button>

              {/* Expanded log viewer */}
              {isExpanded && runId && (
                <div className="border-border border-b px-5 py-3 pl-12">
                  <LogViewer
                    repoTarget={repoTarget}
                    runId={runId}
                  />
                  {checkStatus === "failure" && (
                    <AiFailureExplainer
                      checkName={check.name}
                      repoTarget={repoTarget}
                      runId={runId}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RerunButton({ repoTarget, runId }: { repoTarget: RepoTarget; runId: number }) {
  const rerunMutation = useMutation({
    mutationFn: () => ipc("checks.rerunFailed", { ...repoTarget, runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checks"] });
      toastManager.add({
        title: "Re-run started",
        description: "Failed jobs are being re-run.",
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({
        title: "Re-run failed",
        description: getErrorMessage(err),
        type: "error",
      });
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              rerunMutation.mutate();
            }}
            disabled={rerunMutation.isPending}
            className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary cursor-pointer rounded-sm p-1"
          >
            <RotateCcw
              size={13}
              className={rerunMutation.isPending ? "animate-spin" : ""}
            />
          </button>
        }
      />
      <TooltipPopup>Re-run</TooltipPopup>
    </Tooltip>
  );
}

function formatDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const seconds = Math.floor((end - start) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
