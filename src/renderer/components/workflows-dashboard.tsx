import type { GhWorkflowRun } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Square,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";
import { WorkflowRunsSkeleton } from "./loading-skeletons";
import { RunComparison } from "./run-comparison";
import { RunDetail } from "./run-detail";

/**
 * Workflows dashboard — Phase 2 B1
 *
 * Lists workflows, shows run history, trigger new runs.
 * Detail panel is resizable via drag handle.
 */

export function WorkflowsDashboard() {
  const { cwd } = useWorkspace();
  const { route, navigate } = useRouter();
  const initialRunId = route.view === "workflows" ? (route.runId ?? null) : null;
  const fromPr = route.view === "workflows" ? (route.fromPr ?? null) : null;
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<number | null>(initialRunId);
  const [compareRun, setCompareRun] = useState<number | null>(null);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  /** Shift+click selects a second run for comparison */
  function handleSelectRun(runId: number, shiftKey: boolean) {
    if (shiftKey && selectedRun && selectedRun !== runId) {
      setCompareRun(runId);
    } else {
      setSelectedRun(runId);
      setCompareRun(null);
    }
  }

  // Workflows list
  const workflowsQuery = useQuery({
    queryKey: ["workflows", "list", cwd],
    queryFn: () => ipc("workflows.list", { cwd }),
  });
  const workflows = workflowsQuery.data ?? [];

  // Workflow runs (filtered by selected workflow)
  const runsQuery = useQuery({
    queryKey: ["workflows", "runs", cwd, selectedWorkflow],
    queryFn: () =>
      ipc("workflows.runs", {
        cwd,
        workflowId: selectedWorkflow ?? undefined,
        limit: 200,
      }),
    refetchInterval: 15_000,
  });
  const runs = runsQuery.data ?? [];

  // Client-side search filter
  const filteredRuns = useMemo(() => {
    if (!searchQuery) {
      return runs;
    }
    const q = searchQuery.toLowerCase();
    return runs.filter(
      (run) =>
        run.displayTitle.toLowerCase().includes(q) ||
        run.headBranch.toLowerCase().includes(q) ||
        run.workflowName.toLowerCase().includes(q) ||
        String(run.databaseId).includes(q) ||
        (run.conclusion ?? "").toLowerCase().includes(q),
    );
  }, [runs, searchQuery]);

  const selectedWorkflowName = useMemo(() => {
    if (!selectedWorkflow) {
      return "All workflows";
    }
    return workflows.find((w) => w.id === selectedWorkflow)?.name ?? "Unknown";
  }, [selectedWorkflow, workflows]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back to PR header */}
      {fromPr && (
        <div className="border-border bg-bg-surface flex shrink-0 items-center border-b px-4 py-2">
          <button
            type="button"
            onClick={() => navigate({ view: "review", prNumber: fromPr })}
            className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
          >
            <ArrowLeft size={13} />
            <span>
              Back to PR <span className="font-mono">#{fromPr}</span>
            </span>
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="border-border bg-bg-surface flex shrink-0 items-center gap-3 border-b px-5 py-3">
        {/* Workflow selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setWorkflowMenuOpen(!workflowMenuOpen)}
            className="border-border bg-bg-raised text-text-primary hover:bg-bg-elevated flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
          >
            {selectedWorkflowName}
            <ChevronDown
              size={12}
              className="text-text-tertiary"
            />
          </button>
          {workflowMenuOpen && (
            <div className="border-border bg-bg-elevated absolute top-full left-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border p-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkflow(null);
                  setWorkflowMenuOpen(false);
                }}
                className={`flex w-full cursor-pointer rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                  !selectedWorkflow
                    ? "bg-accent-muted text-accent-text"
                    : "text-text-secondary hover:bg-bg-raised"
                }`}
              >
                All workflows
              </button>
              {workflows.map((wf) => (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => {
                    setSelectedWorkflow(wf.id);
                    setWorkflowMenuOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedWorkflow === wf.id
                      ? "bg-accent-muted text-accent-text"
                      : "text-text-secondary hover:bg-bg-raised"
                  }`}
                >
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${
                      wf.state === "active" ? "bg-success" : "bg-text-ghost"
                    }`}
                  />
                  {wf.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="border-border bg-bg-raised flex max-w-xs flex-1 items-center gap-2 rounded-md border px-2 py-1.5">
          <Search
            size={13}
            className="text-text-tertiary shrink-0"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search runs..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                (e.target as HTMLElement).blur();
              }
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-text-tertiary hover:text-text-primary cursor-pointer text-[10px]"
            >
              esc
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Trigger button */}
        {selectedWorkflow && (
          <TriggerButton
            cwd={cwd}
            workflowId={selectedWorkflow}
          />
        )}
      </div>

      {/* Content */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1"
      >
        {/* Run list */}
        <ResizablePanel
          defaultSize="60%"
          minSize="30%"
        >
          <div className="h-full overflow-y-auto">
            {runsQuery.isLoading && <WorkflowRunsSkeleton />}

            {!runsQuery.isLoading && filteredRuns.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <p className="text-text-tertiary text-sm">
                  {searchQuery ? "No runs match your search" : "No workflow runs found"}
                </p>
              </div>
            )}

            {filteredRuns.length > 0 && (
              <RunTable
                runs={filteredRuns}
                selectedRun={selectedRun}
                compareRun={compareRun}
                onSelectRun={handleSelectRun}
                cwd={cwd}
              />
            )}
          </div>
        </ResizablePanel>

        {selectedRun && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize="40%"
              minSize="20%"
              maxSize="65%"
            >
              <div className="bg-bg-surface h-full overflow-y-auto">
                {compareRun ? (
                  <RunComparison
                    cwd={cwd}
                    baseRunId={selectedRun}
                    compareRunId={compareRun}
                  />
                ) : (
                  <RunDetail
                    cwd={cwd}
                    runId={selectedRun}
                  />
                )}
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run table
// ---------------------------------------------------------------------------

function RunTable({
  runs,
  selectedRun,
  compareRun,
  onSelectRun,
  cwd,
}: {
  runs: GhWorkflowRun[];
  selectedRun: number | null;
  compareRun: number | null;
  onSelectRun: (id: number, shiftKey: boolean) => void;
  cwd: string;
}) {
  return (
    <div className="divide-border divide-y">
      {runs.map((run) => (
        <RunRow
          key={run.databaseId}
          run={run}
          isSelected={selectedRun === run.databaseId}
          isCompare={compareRun === run.databaseId}
          onSelect={(shiftKey) => onSelectRun(run.databaseId, shiftKey)}
          cwd={cwd}
        />
      ))}
    </div>
  );
}

function RunRow({
  run,
  isSelected,
  isCompare,
  onSelect,
  cwd,
}: {
  run: GhWorkflowRun;
  isSelected: boolean;
  isCompare: boolean;
  onSelect: (shiftKey: boolean) => void;
  cwd: string;
}) {
  const rerunMutation = useMutation({
    mutationFn: (args: { cwd: string; runId: number }) => ipc("workflows.rerunAll", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "runs"] });
      toastManager.add({ title: "Re-run started", type: "success" });
    },
    onError: () => {
      toastManager.add({ title: "Re-run failed", type: "error" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (args: { cwd: string; runId: number }) => ipc("workflows.cancel", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "runs"] });
      toastManager.add({ title: "Run cancelled", type: "success" });
    },
    onError: () => {
      toastManager.add({ title: "Cancel failed", type: "error" });
    },
  });

  const StatusIcon = getStatusIcon(run.status, run.conclusion);
  const statusColor = getStatusColor(run.status, run.conclusion);
  const isInProgress = run.status === "in_progress" || run.status === "queued";

  return (
    <button
      type="button"
      onClick={(e) => onSelect(e.shiftKey)}
      className={`flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition-colors ${
        isSelected
          ? "bg-accent-muted"
          : isCompare
            ? "bg-info/8 border-l-info border-l-2"
            : "hover:bg-bg-raised"
      }`}
    >
      <StatusIcon
        size={16}
        className={`shrink-0 ${statusColor} ${isInProgress ? "animate-spin" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary truncate text-xs font-medium">{run.displayTitle}</p>
        <p className="text-text-tertiary mt-0.5 flex items-center gap-1.5 font-mono text-[10px]">
          <span>{run.workflowName}</span>
          <span className="text-text-ghost">·</span>
          <span>{run.headBranch}</span>
          <span className="text-text-ghost">·</span>
          <span>{relativeTime(new Date(run.createdAt))}</span>
          {run.attempt > 1 && (
            <>
              <span className="text-text-ghost">·</span>
              <span className="text-warning">attempt {run.attempt}</span>
            </>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {run.conclusion === "failure" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              rerunMutation.mutate({ cwd, runId: run.databaseId });
            }}
            className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary cursor-pointer rounded-sm p-1"
            title="Re-run"
          >
            <RotateCcw size={13} />
          </button>
        )}
        {isInProgress && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cancelMutation.mutate({ cwd, runId: run.databaseId });
            }}
            className="text-text-tertiary hover:bg-bg-raised hover:text-destructive cursor-pointer rounded-sm p-1"
            title="Cancel"
          >
            <Square size={13} />
          </button>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function getStatusIcon(status: string, conclusion: string | null): typeof CheckCircle2 {
  if (status === "completed") {
    switch (conclusion) {
      case "success": {
        return CheckCircle2;
      }
      case "failure": {
        return XCircle;
      }
      default: {
        return Clock;
      }
    }
  }
  return Loader2;
}

function getStatusColor(status: string, conclusion: string | null): string {
  if (status === "completed") {
    switch (conclusion) {
      case "success": {
        return "text-success";
      }
      case "failure": {
        return "text-destructive";
      }
      default: {
        return "text-text-tertiary";
      }
    }
  }
  return "text-warning";
}

// ---------------------------------------------------------------------------
// Trigger button
// ---------------------------------------------------------------------------

function TriggerButton({ cwd, workflowId }: { cwd: string; workflowId: number }) {
  const triggerMutation = useMutation({
    mutationFn: (args: { cwd: string; workflowId: string; ref: string }) =>
      ipc("workflows.trigger", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "runs"] });
      toastManager.add({ title: "Workflow triggered", type: "success" });
    },
    onError: () => {
      toastManager.add({ title: "Trigger failed", type: "error" });
    },
  });

  return (
    <Button
      size="sm"
      className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1.5"
      disabled={triggerMutation.isPending}
      onClick={() => {
        triggerMutation.mutate({
          cwd,
          workflowId: String(workflowId),
          ref: "main",
        });
      }}
    >
      {triggerMutation.isPending ? <Spinner className="h-3 w-3" /> : <Play size={13} />}
      Trigger
    </Button>
  );
}
