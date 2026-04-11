/* eslint-disable import/max-dependencies -- This screen is a top-level dashboard composition. */
import type { GhWorkflowRun, RepoTarget } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/renderer/components/shared/confirm-dialog";
import { WorkflowRunsSkeleton } from "@/renderer/components/shared/loading-skeletons";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
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

import { RunComparison } from "./run-comparison";
import { RunDetail } from "./run-detail";

/**
 * Workflows dashboard — Phase 2 B1
 *
 * Lists workflows, shows run history, trigger new runs.
 * Detail panel is resizable via drag handle.
 */

export function WorkflowsDashboard() {
  const { repoTarget, nwo } = useWorkspace();
  const { route, navigate } = useRouter();
  const initialRunId = route.view === "workflows" ? (route.runId ?? null) : null;
  const fromPr = route.view === "workflows" ? (route.fromPr ?? null) : null;
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<number | null>(initialRunId);
  const [compareRun, setCompareRun] = useState<number | null>(null);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState("");
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
    queryKey: ["workflows", "list", nwo],
    queryFn: () => ipc("workflows.list", { ...repoTarget }),
  });
  const workflows = workflowsQuery.data ?? [];

  // Workflow runs (filtered by selected workflow)
  const runsQuery = useQuery({
    queryKey: ["workflows", "runs", nwo, selectedWorkflow],
    queryFn: () =>
      ipc("workflows.runs", {
        ...repoTarget,
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

  function closeWorkflowMenu() {
    setWorkflowMenuOpen(false);
    setWorkflowSearch("");
  }

  const filteredWorkflows = useMemo(() => {
    if (!workflowSearch) {
      return workflows;
    }
    const q = workflowSearch.toLowerCase();
    return workflows.filter((wf) => wf.name.toLowerCase().includes(q));
  }, [workflows, workflowSearch]);

  const showAllWorkflowsOption =
    !workflowSearch || "all workflows".includes(workflowSearch.toLowerCase());

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
            onClick={() => {
              if (workflowMenuOpen) {
                closeWorkflowMenu();
              } else {
                setWorkflowMenuOpen(true);
              }
            }}
            className="border-border bg-bg-raised text-text-primary hover:bg-bg-elevated flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
          >
            {selectedWorkflowName}
            <ChevronDown
              size={12}
              className="text-text-tertiary"
            />
          </button>
          {workflowMenuOpen && (
            <>
              {/* Click-outside backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={closeWorkflowMenu}
                onKeyDown={() => {}}
                role="presentation"
              />
              <div className="border-border bg-bg-elevated absolute top-full left-0 z-20 mt-1 w-56 rounded-md border shadow-lg">
                {/* Search input */}
                <div className="border-border border-b p-1.5">
                  <div className="bg-bg-raised flex items-center gap-1.5 rounded-sm px-2 py-1">
                    <Search
                      size={11}
                      className="text-text-tertiary shrink-0"
                    />
                    <input
                      ref={(node) => {
                        if (node) {
                          node.focus();
                        }
                      }}
                      type="text"
                      value={workflowSearch}
                      onChange={(e) => setWorkflowSearch(e.target.value)}
                      placeholder="Search workflows…"
                      className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") {
                          closeWorkflowMenu();
                        }
                      }}
                    />
                  </div>
                </div>
                {/* Workflow list */}
                <div className="max-h-64 overflow-y-auto p-1">
                  {showAllWorkflowsOption && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkflow(null);
                        closeWorkflowMenu();
                      }}
                      className={`flex w-full cursor-pointer rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                        selectedWorkflow
                          ? "text-text-secondary hover:bg-bg-raised"
                          : "bg-accent-muted text-accent-text"
                      }`}
                    >
                      All workflows
                    </button>
                  )}
                  {filteredWorkflows.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => {
                        setSelectedWorkflow(wf.id);
                        closeWorkflowMenu();
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                        selectedWorkflow === wf.id
                          ? "bg-accent-muted text-accent-text"
                          : "text-text-secondary hover:bg-bg-raised"
                      }`}
                    >
                      <div
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          wf.state === "active" ? "bg-success" : "bg-text-ghost"
                        }`}
                      />
                      {wf.name}
                    </button>
                  ))}
                  {filteredWorkflows.length === 0 && !showAllWorkflowsOption && (
                    <p className="text-text-tertiary px-3 py-2 text-center text-xs">
                      No workflows found
                    </p>
                  )}
                </div>
              </div>
            </>
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
            repoTarget={repoTarget}
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
                repoTarget={repoTarget}
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
                    repoTarget={repoTarget}
                    baseRunId={selectedRun}
                    compareRunId={compareRun}
                  />
                ) : (
                  <RunDetail
                    repoTarget={repoTarget}
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
  repoTarget,
}: {
  runs: GhWorkflowRun[];
  selectedRun: number | null;
  compareRun: number | null;
  onSelectRun: (id: number, shiftKey: boolean) => void;
  repoTarget: RepoTarget;
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
          repoTarget={repoTarget}
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
  repoTarget,
}: {
  run: GhWorkflowRun;
  isSelected: boolean;
  isCompare: boolean;
  onSelect: (shiftKey: boolean) => void;
  repoTarget: RepoTarget;
}) {
  const rerunMutation = useMutation({
    mutationFn: (runId: number) => ipc("workflows.rerunAll", { ...repoTarget, runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "runs"] });
      toastManager.add({ title: "Re-run started", type: "success" });
    },
    onError: () => {
      toastManager.add({ title: "Re-run failed", type: "error" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: number) => ipc("workflows.cancel", { ...repoTarget, runId }),
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
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    rerunMutation.mutate(run.databaseId);
                  }}
                  className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary cursor-pointer rounded-sm p-1"
                >
                  <RotateCcw size={13} />
                </button>
              }
            />
            <TooltipPopup>Re-run</TooltipPopup>
          </Tooltip>
        )}
        {isInProgress && (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="text-text-tertiary hover:bg-bg-raised hover:text-destructive cursor-pointer rounded-sm p-1"
                title="Cancel"
              >
                <Square size={13} />
              </button>
            }
            title="Cancel workflow run?"
            description={`This will cancel "${run.displayTitle}". The run cannot be resumed once cancelled.`}
            confirmLabel="Cancel run"
            onConfirm={() => cancelMutation.mutate(run.databaseId)}
          />
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

function TriggerButton({ repoTarget, workflowId }: { repoTarget: RepoTarget; workflowId: number }) {
  const triggerMutation = useMutation({
    mutationFn: (args: { workflowId: string; ref: string }) =>
      ipc("workflows.trigger", { ...repoTarget, ...args }),
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
