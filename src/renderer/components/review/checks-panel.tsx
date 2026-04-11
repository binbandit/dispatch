/* eslint-disable import/max-dependencies -- This panel intentionally combines run actions, live status, logs, and AI explanation affordances. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { AiFailureExplainer } from "@/renderer/components/review/ai/ai-failure-explainer";
import { LogViewer } from "@/renderer/components/workflows/log-viewer";
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
    <div className="flex flex-col gap-0.5 p-2">
      {/* Summary */}
      <div className="mb-1 flex items-center gap-2 px-2 pb-1.5">
        <span className="text-success font-mono text-[10px]">{passCount} passed</span>
        {failCount > 0 && (
          <span className="text-destructive font-mono text-[10px]">{failCount} failed</span>
        )}
      </div>

      {/* Check items */}
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
              className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left"
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${color}`}>
                <Icon
                  size={14}
                  className={spin ? "animate-spin" : ""}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate text-xs font-[450]">{check.name}</p>
                <p className="text-text-tertiary font-mono text-[10px]">
                  {check.completedAt
                    ? formatDuration(check.startedAt, check.completedAt)
                    : check.startedAt
                      ? "Running..."
                      : check.status}
                </p>
              </div>
              {checkStatus === "failure" && runId && (
                <RerunButton
                  repoTarget={repoTarget}
                  runId={runId}
                />
              )}
            </button>

            {/* Expanded log viewer */}
            {isExpanded && runId && (
              <div className="mt-1 mb-1 ml-6">
                <LogViewer
                  repoTarget={repoTarget}
                  runId={runId}
                />
                {/* AI explain failure button for failed checks */}
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
      toastManager.add({ title: "Re-run failed", description: String(err.message), type: "error" });
    },
  });

  return (
    <button
      type="button"
      className="text-destructive hover:text-destructive inline-flex h-6 cursor-pointer items-center gap-1 px-1.5"
      onClick={(e) => {
        e.stopPropagation();
        rerunMutation.mutate();
      }}
      disabled={rerunMutation.isPending}
    >
      <RotateCcw
        size={11}
        className={rerunMutation.isPending ? "animate-spin" : ""}
      />
      <span className="text-[10px]">Re-run</span>
    </button>
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
