import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { useAiConfig } from "./ai-explanation";
import { LogViewer } from "./log-viewer";

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
  const { cwd } = useWorkspace();
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const checksQuery = useQuery({
    queryKey: ["checks", "list", cwd, prNumber],
    queryFn: () => ipc("checks.list", { cwd, prNumber }),
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
                  cwd={cwd}
                  runId={runId}
                />
              )}
            </button>

            {/* Expanded log viewer */}
            {isExpanded && runId && (
              <div className="mt-1 mb-1 ml-6">
                <LogViewer
                  cwd={cwd}
                  runId={runId}
                />
                {/* AI explain failure button for failed checks */}
                {checkStatus === "failure" && (
                  <AiFailureExplainer
                    checkName={check.name}
                    cwd={cwd}
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

function RerunButton({ cwd, runId }: { cwd: string; runId: number }) {
  const rerunMutation = useMutation({
    mutationFn: (args: { cwd: string; runId: number }) => ipc("checks.rerunFailed", args),
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
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive h-6 gap-1 px-1.5"
      onClick={(e) => {
        e.stopPropagation();
        rerunMutation.mutate({ cwd, runId });
      }}
      disabled={rerunMutation.isPending}
    >
      <RotateCcw
        size={11}
        className={rerunMutation.isPending ? "animate-spin" : ""}
      />
      <span className="text-[10px]">Re-run</span>
    </Button>
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

// ---------------------------------------------------------------------------
// AI failure explainer
// ---------------------------------------------------------------------------

function AiFailureExplainer({
  checkName,
  cwd,
  runId,
}: {
  checkName: string;
  cwd: string;
  runId: number;
}) {
  const config = useAiConfig();
  const [explanation, setExplanation] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const logQuery = useQuery({
    queryKey: ["checks", "logs", cwd, runId],
    queryFn: () => ipc("checks.logs", { cwd, runId }),
    staleTime: 60_000,
    enabled: false, // Only fetch when user clicks
  });

  const explainMutation = useMutation({
    mutationFn: async () => {
      // Fetch logs first if not cached
      const logResult = await logQuery.refetch();
      const logText = logResult.data ?? "";
      // Take the last 200 lines (where errors typically are)
      const logTail = logText.split("\n").slice(-200).join("\n");

      const prompt = `A CI/CD pipeline has failed. Explain the failure in plain English and suggest a fix. Be concise (3-4 sentences max).\n\nCheck name: ${checkName}\nStatus: Failed\n\nLog output (last 200 lines):\n${logTail}`;

      // Try ACP first
      try {
        const acpResult = await ipc("acp.complete", { cwd, text: prompt });
        return acpResult.text;
      } catch {
        // Fall back to direct API
        return ipc("ai.complete", {
          provider: config.provider ?? undefined,
          model: config.model ?? undefined,
          baseUrl: config.baseUrl ?? undefined,
          messages: [
            {
              role: "system",
              content:
                "A CI/CD pipeline has failed. Explain the failure in plain English and suggest a fix. Be concise (3-4 sentences max).",
            },
            {
              role: "user",
              content: `Check name: ${checkName}\nStatus: Failed\n\nLog output (last 200 lines):\n${logTail}`,
            },
          ],
          maxTokens: 512,
        });
      }
    },
    onSuccess: (text) => {
      setExplanation(text);
    },
  });

  if (!config.isConfigured || dismissed) {
    return null;
  }

  if (explanation) {
    return (
      <div className="border-primary/30 bg-bg-surface mt-2 rounded-md border p-3">
        <div className="flex items-center gap-1.5">
          <Sparkles
            size={12}
            className="text-primary"
          />
          <span className="text-primary text-[10px] font-medium">AI Explanation</span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-text-ghost hover:text-text-primary ml-auto cursor-pointer"
          >
            <XCircle size={11} />
          </button>
        </div>
        <p className="text-text-secondary mt-1.5 text-xs leading-relaxed">{explanation}</p>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-primary hover:text-accent-hover mt-1 gap-1 text-[10px]"
      onClick={() => explainMutation.mutate()}
      disabled={explainMutation.isPending}
    >
      {explainMutation.isPending ? <Spinner className="h-3 w-3" /> : <Sparkles size={11} />}
      Explain failure with AI
    </Button>
  );
}
