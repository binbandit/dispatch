/* eslint-disable import/max-dependencies -- This screen composes workflow detail controls, log inspection, and AI failure analysis. */
import type { GhWorkflowRunDetail, GhWorkflowRunJob } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AiFailureExplainer } from "@/renderer/components/review/ai/ai-failure-explainer";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitGraph,
  List,
  Loader2,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JobGraphView } from "./job-graph-view";
import { LogViewer } from "./log-viewer";

/**
 * Run detail panel — Gantt-style job timeline + step viewer + log search.
 * Supports two view modes: "list" (default Gantt + logs) and "graph" (DAG graph).
 */

type DetailViewMode = "list" | "graph";

interface RunDetailProps {
  cwd: string;
  runId: number;
}

export function RunDetail({ cwd, runId }: RunDetailProps) {
  const [logSearch, setLogSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [viewMode, setViewMode] = useState<DetailViewMode>("list");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset search when run changes
  const prevRunId = useRef(runId);
  if (prevRunId.current !== runId) {
    prevRunId.current = runId;
    setLogSearch("");
    setMatchIndex(0);
    setMatchCount(0);
  }

  const detailQuery = useQuery({
    queryKey: ["workflows", "runDetail", cwd, runId],
    queryFn: () => ipc("workflows.runDetail", { cwd, runId }),
    refetchInterval: 10_000,
  });

  const workflowId = detailQuery.data?.workflowDatabaseId;
  const jobGraphQuery = useQuery({
    queryKey: ["workflows", "jobGraph", cwd, workflowId],
    queryFn: () => ipc("workflows.jobGraph", { cwd, workflowId: String(workflowId ?? "") }),
    enabled: viewMode === "graph" && workflowId !== undefined,
    staleTime: 300_000,
  });

  const rerunMutation = useMutation({
    mutationFn: () => ipc("workflows.rerunAll", { cwd, runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toastManager.add({ title: "Re-run started", type: "success" });
    },
  });

  const rerunFailedMutation = useMutation({
    mutationFn: () => ipc("checks.rerunFailed", { cwd, runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toastManager.add({ title: "Failed jobs re-running", type: "success" });
    },
  });

  // Cmd/Ctrl+F to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleMatchCountChange = useCallback((count: number) => {
    setMatchCount(count);
    setMatchIndex(0);
  }, []);

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  if (!detailQuery.data) {
    return (
      <div className="text-text-tertiary px-4 py-8 text-center text-xs">
        Failed to load run details
      </div>
    );
  }

  const run = detailQuery.data;
  const hasFailed = run.jobs.some((job) => isWorkflowFailure(job.conclusion));

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-border border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-text-primary text-sm font-semibold">{run.displayTitle}</h3>
            <p className="text-text-tertiary mt-0.5 font-mono text-[11px]">
              {run.workflowName} · {run.headBranch} · {run.headSha.slice(0, 8)}
            </p>
          </div>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[viewMode]}
            onValueChange={(values) => {
              const next = values[0] as DetailViewMode | undefined;
              if (next) {
                setViewMode(next);
              }
            }}
          >
            <ToggleGroupItem
              value="list"
              aria-label="List view"
            >
              <List size={13} />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="graph"
              aria-label="Graph view"
            >
              <GitGraph size={13} />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs"
            onClick={() => rerunMutation.mutate()}
            disabled={rerunMutation.isPending}
          >
            <RotateCcw
              size={11}
              className={rerunMutation.isPending ? "animate-spin" : ""}
            />
            Re-run all
          </Button>
          {hasFailed && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive gap-1 text-xs"
              onClick={() => rerunFailedMutation.mutate()}
              disabled={rerunFailedMutation.isPending}
            >
              <RotateCcw
                size={11}
                className={rerunFailedMutation.isPending ? "animate-spin" : ""}
              />
              Re-run failed
            </Button>
          )}
        </div>
        {hasFailed && (
          <AiFailureExplainer
            checkName={buildFailureExplanationLabel(run)}
            cwd={cwd}
            runId={runId}
          />
        )}
      </div>

      {viewMode === "graph" ? (
        <div className="flex-1 overflow-auto">
          {jobGraphQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="text-primary h-5 w-5" />
            </div>
          ) : (
            <JobGraphView
              jobs={run.jobs}
              graph={jobGraphQuery.data ?? { jobs: [] }}
            />
          )}
        </div>
      ) : (
        <>
          {/* Log search bar */}
          <div className="border-border flex items-center gap-2 border-b px-4 py-2">
            <Search
              size={13}
              className="text-text-tertiary shrink-0"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Search logs..."
              className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setLogSearch("");
                  (e.target as HTMLElement).blur();
                }
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    setMatchIndex((i) => (i > 0 ? i - 1 : matchCount - 1));
                  } else {
                    setMatchIndex((i) => (i < matchCount - 1 ? i + 1 : 0));
                  }
                }
              }}
            />
            {logSearch && matchCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-text-tertiary font-mono text-[10px]">
                  {matchIndex + 1}/{matchCount}
                </span>
                <button
                  type="button"
                  onClick={() => setMatchIndex((i) => (i > 0 ? i - 1 : matchCount - 1))}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer rounded-sm p-0.5"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setMatchIndex((i) => (i < matchCount - 1 ? i + 1 : 0))}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer rounded-sm p-0.5"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            )}
            {logSearch && matchCount === 0 && (
              <span className="text-text-ghost text-[10px]">No matches</span>
            )}
          </div>

          {/* Gantt timeline */}
          <div className="border-border border-b px-4 py-3">
            <GanttTimeline jobs={run.jobs} />
          </div>

          {/* Job list */}
          <div className="flex-1">
            {run.jobs.map((job) => (
              <JobRow
                key={job.name}
                job={job}
                cwd={cwd}
                runId={runId}
                searchQuery={logSearch}
                activeMatchIndex={matchIndex}
                onMatchCountChange={handleMatchCountChange}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt timeline
// ---------------------------------------------------------------------------

function GanttTimeline({ jobs }: { jobs: GhWorkflowRunJob[] }) {
  const timeline = useMemo(() => {
    const starts = jobs.filter((j) => j.startedAt).map((j) => new Date(j.startedAt).getTime());
    const ends = jobs
      .filter((j): j is GhWorkflowRunJob & { completedAt: string } => Boolean(j.completedAt))
      .map((j) => new Date(j.completedAt).getTime());

    if (starts.length === 0) {
      return null;
    }

    const minTime = Math.min(...starts);
    const maxTime = Math.max(...ends, ...starts);
    const span = maxTime - minTime || 1;

    return jobs.map((job) => {
      const start = job.startedAt ? new Date(job.startedAt).getTime() : minTime;
      const end = job.completedAt ? new Date(job.completedAt).getTime() : maxTime;
      const leftPct = ((start - minTime) / span) * 100;
      const widthPct = Math.max(((end - start) / span) * 100, 2);
      const durationSec = Math.floor((end - start) / 1000);
      const durationStr =
        durationSec < 60
          ? `${durationSec}s`
          : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

      return { name: job.name, conclusion: job.conclusion, leftPct, widthPct, durationStr };
    });
  }, [jobs]);

  if (!timeline) {
    return <p className="text-text-tertiary text-xs">No timing data available</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {timeline.map((bar) => (
        <div
          key={bar.name}
          className="flex items-center gap-2"
        >
          <span className="text-text-tertiary w-20 shrink-0 truncate text-right font-mono text-[10px]">
            {bar.name}
          </span>
          <div className="bg-bg-raised relative h-4 flex-1 overflow-hidden rounded-sm">
            <div
              className={`absolute top-0 h-full rounded-sm ${
                bar.conclusion === "success"
                  ? "bg-success/60"
                  : isWorkflowFailure(bar.conclusion)
                    ? "bg-destructive/60"
                    : bar.conclusion === "cancelled" || bar.conclusion === "skipped"
                      ? "bg-text-ghost/40"
                      : "bg-warning/60"
              }`}
              style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
            />
            <span className="text-text-primary absolute inset-0 flex items-center px-1 font-mono text-[9px]">
              {bar.durationStr}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job row with expandable steps + log search
// ---------------------------------------------------------------------------

function JobRow({
  job,
  cwd,
  runId,
  searchQuery,
  activeMatchIndex,
  onMatchCountChange,
}: {
  job: GhWorkflowRunJob;
  cwd: string;
  runId: number;
  searchQuery: string;
  activeMatchIndex: number;
  onMatchCountChange: (count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = resolveStatusIcon(job.conclusion);

  // Auto-expand failed jobs (render-time state adjustment)
  const [prevConclusion, setPrevConclusion] = useState(job.conclusion);
  if (job.conclusion !== prevConclusion) {
    setPrevConclusion(job.conclusion);
    if (isWorkflowFailure(job.conclusion)) {
      setExpanded(true);
    }
  }

  return (
    <div className="border-border-subtle border-b">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left"
      >
        {expanded ? (
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
        <span className="text-text-primary flex-1 text-xs font-medium">{job.name}</span>
        <span className="text-text-tertiary font-mono text-[10px]">{computeJobDuration(job)}</span>
      </button>
      {expanded && (
        <div className="bg-bg-root px-4 pb-2">
          {/* Steps */}
          {job.steps.map((step) => {
            const stepStatus = resolveStatusIcon(step.conclusion);
            return (
              <div
                key={step.number}
                className="flex items-center gap-2 py-1 pl-6"
              >
                <stepStatus.icon
                  size={11}
                  className={`shrink-0 ${stepStatus.color} ${stepStatus.spin ? "animate-spin" : ""}`}
                />
                <span className="text-text-secondary flex-1 text-[11px]">{step.name}</span>
              </div>
            );
          })}
          {/* Logs */}
          <div className="mt-2 pl-6">
            <LogViewer
              cwd={cwd}
              runId={runId}
              searchQuery={searchQuery}
              activeMatchIndex={activeMatchIndex}
              onMatchCountChange={onMatchCountChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function resolveStatusIcon(conclusion: string | null) {
  if (conclusion === "success") {
    return { icon: CheckCircle2, color: "text-success", spin: false };
  }
  if (conclusion === "failure" || conclusion === "error") {
    return { icon: XCircle, color: "text-destructive", spin: false };
  }
  if (conclusion === "cancelled" || conclusion === "skipped") {
    return { icon: XCircle, color: "text-text-tertiary", spin: false };
  }
  return { icon: Loader2, color: "text-warning", spin: true };
}

function isWorkflowFailure(conclusion: string | null): boolean {
  return conclusion === "failure" || conclusion === "error";
}

function buildFailureExplanationLabel(run: GhWorkflowRunDetail): string {
  const failedJobs = run.jobs
    .filter((job) => isWorkflowFailure(job.conclusion))
    .map((job) => job.name);

  if (failedJobs.length === 0) {
    return run.workflowName;
  }

  if (failedJobs.length === 1) {
    return `${run.workflowName} / ${failedJobs[0]}`;
  }

  const visibleJobs = failedJobs.slice(0, 3);
  const remainingJobs = failedJobs.length - visibleJobs.length;
  const suffix = remainingJobs > 0 ? ` +${remainingJobs} more` : "";

  return `${run.workflowName} / ${visibleJobs.join(", ")}${suffix}`;
}

function computeJobDuration(job: GhWorkflowRunJob): string {
  if (!job.startedAt || !job.completedAt) {
    return "—";
  }
  const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
