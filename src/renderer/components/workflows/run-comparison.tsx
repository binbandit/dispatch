import type { GhWorkflowRunDetail, GhWorkflowRunJob, RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Equal, Minus } from "lucide-react";
import { useMemo } from "react";

/**
 * Run Comparison — side-by-side comparison of two workflow runs.
 *
 * Shows per-job timing deltas: which jobs got faster/slower,
 * total duration change, and a visual bar chart.
 *
 * This is the "genuinely novel feature nobody offers" from PHASE-2.
 */

interface RunComparisonProps {
  repoTarget: RepoTarget;
  baseRunId: number;
  compareRunId: number;
}

export function RunComparison({ repoTarget, baseRunId, compareRunId }: RunComparisonProps) {
  const baseQuery = useQuery({
    queryKey: ["workflows", "runDetail", repoTarget.owner, repoTarget.repo, baseRunId],
    queryFn: () => ipc("workflows.runDetail", { ...repoTarget, runId: baseRunId }),
  });

  const compareQuery = useQuery({
    queryKey: ["workflows", "runDetail", repoTarget.owner, repoTarget.repo, compareRunId],
    queryFn: () => ipc("workflows.runDetail", { ...repoTarget, runId: compareRunId }),
  });

  if (baseQuery.isLoading || compareQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  if (!baseQuery.data || !compareQuery.data) {
    return (
      <div className="text-text-tertiary px-4 py-8 text-center text-xs">
        Failed to load run data
      </div>
    );
  }

  return (
    <ComparisonContent
      base={baseQuery.data}
      compare={compareQuery.data}
    />
  );
}

// ---------------------------------------------------------------------------
// Comparison content
// ---------------------------------------------------------------------------

interface JobDelta {
  name: string;
  baseDuration: number | null;
  compareDuration: number | null;
  delta: number | null;
  deltaPercent: number | null;
  baseConclusion: string | null;
  compareConclusion: string | null;
}

function jobDurationMs(job: GhWorkflowRunJob): number | null {
  if (!job.startedAt || !job.completedAt) {
    return null;
  }
  return new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ComparisonContent({
  base,
  compare,
}: {
  base: GhWorkflowRunDetail;
  compare: GhWorkflowRunDetail;
}) {
  const deltas = useMemo(() => {
    // Build a map of job names from both runs
    const allJobNames = new Set<string>();
    for (const job of base.jobs) {
      allJobNames.add(job.name);
    }
    for (const job of compare.jobs) {
      allJobNames.add(job.name);
    }

    const baseJobMap = new Map(base.jobs.map((j) => [j.name, j]));
    const compareJobMap = new Map(compare.jobs.map((j) => [j.name, j]));

    const result: JobDelta[] = [];
    for (const name of allJobNames) {
      const baseJob = baseJobMap.get(name);
      const compareJob = compareJobMap.get(name);
      const baseDuration = baseJob ? jobDurationMs(baseJob) : null;
      const compareDuration = compareJob ? jobDurationMs(compareJob) : null;

      let delta: number | null = null;
      let deltaPercent: number | null = null;
      if (baseDuration !== null && compareDuration !== null) {
        delta = compareDuration - baseDuration;
        deltaPercent = baseDuration > 0 ? (delta / baseDuration) * 100 : null;
      }

      result.push({
        name,
        baseDuration,
        compareDuration,
        delta,
        deltaPercent,
        baseConclusion: baseJob?.conclusion ?? null,
        compareConclusion: compareJob?.conclusion ?? null,
      });
    }

    // Sort: biggest regression first, then biggest improvement
    result.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

    return result;
  }, [base.jobs, compare.jobs]);

  // Total durations
  const baseTotalMs = base.jobs.reduce((sum, j) => sum + (jobDurationMs(j) ?? 0), 0);
  const compareTotalMs = compare.jobs.reduce((sum, j) => sum + (jobDurationMs(j) ?? 0), 0);
  const totalDelta = compareTotalMs - baseTotalMs;
  const totalDeltaPercent = baseTotalMs > 0 ? (totalDelta / baseTotalMs) * 100 : 0;

  // Max duration for bar scaling
  const maxDuration = Math.max(
    ...deltas.map((d) => Math.max(d.baseDuration ?? 0, d.compareDuration ?? 0)),
    1,
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-border border-b px-4 py-3">
        <h3 className="text-text-primary text-sm font-semibold">Run Comparison</h3>
        <div className="text-text-tertiary mt-1 flex items-center gap-2 font-mono text-[11px]">
          <span>{base.headSha.slice(0, 8)}</span>
          <span className="text-text-ghost">vs</span>
          <span>{compare.headSha.slice(0, 8)}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="border-border flex items-center gap-4 border-b px-4 py-3">
        <SummaryCard
          label="Base"
          value={formatDuration(baseTotalMs)}
          sub={base.displayTitle}
        />
        <SummaryCard
          label="Compare"
          value={formatDuration(compareTotalMs)}
          sub={compare.displayTitle}
        />
        <div className="border-border bg-bg-raised flex flex-1 flex-col items-center rounded-md border px-3 py-2">
          <span className="text-text-tertiary text-[10px]">Delta</span>
          <span
            className={`font-mono text-sm font-semibold ${
              totalDelta > 0
                ? "text-destructive"
                : totalDelta < 0
                  ? "text-success"
                  : "text-text-secondary"
            }`}
          >
            {totalDelta > 0 ? "+" : ""}
            {formatDuration(Math.abs(totalDelta))}
          </span>
          <span
            className={`font-mono text-[10px] ${
              totalDelta > 0
                ? "text-destructive"
                : totalDelta < 0
                  ? "text-success"
                  : "text-text-ghost"
            }`}
          >
            {totalDelta > 0 ? "+" : ""}
            {totalDeltaPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Per-job comparison */}
      <div className="flex-1">
        {deltas.map((job) => (
          <JobDeltaRow
            key={job.name}
            job={job}
            maxDuration={maxDuration}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-border bg-bg-raised flex flex-1 flex-col rounded-md border px-3 py-2">
      <span className="text-text-tertiary text-[10px]">{label}</span>
      <span className="text-text-primary font-mono text-sm font-semibold">{value}</span>
      <span className="text-text-ghost mt-0.5 truncate text-[10px]">{sub}</span>
    </div>
  );
}

function JobDeltaRow({ job, maxDuration }: { job: JobDelta; maxDuration: number }) {
  const basePct = job.baseDuration === null ? 0 : (job.baseDuration / maxDuration) * 100;
  const comparePct = job.compareDuration === null ? 0 : (job.compareDuration / maxDuration) * 100;

  const DeltaIcon =
    job.delta === null ? Minus : job.delta > 1000 ? ArrowUp : job.delta < -1000 ? ArrowDown : Equal;

  const deltaColor =
    job.delta === null
      ? "text-text-ghost"
      : job.delta > 1000
        ? "text-destructive"
        : job.delta < -1000
          ? "text-success"
          : "text-text-tertiary";

  return (
    <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-2">
      {/* Job name */}
      <span className="text-text-primary w-32 shrink-0 truncate text-[11px] font-medium">
        {job.name}
      </span>

      {/* Duration bars */}
      <div className="flex flex-1 flex-col gap-1">
        {/* Base bar */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-ghost w-8 text-right font-mono text-[9px]">
            {job.baseDuration === null ? "—" : formatDuration(job.baseDuration)}
          </span>
          <div className="bg-bg-raised relative h-[6px] flex-1 overflow-hidden rounded-full">
            <div
              className="bg-info/50 absolute left-0 h-full rounded-full"
              style={{ width: `${basePct}%` }}
            />
          </div>
        </div>
        {/* Compare bar */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-ghost w-8 text-right font-mono text-[9px]">
            {job.compareDuration === null ? "—" : formatDuration(job.compareDuration)}
          </span>
          <div className="bg-bg-raised relative h-[6px] flex-1 overflow-hidden rounded-full">
            <div
              className={`absolute left-0 h-full rounded-full ${
                job.compareConclusion === "failure" ? "bg-destructive/50" : "bg-primary/50"
              }`}
              style={{ width: `${comparePct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Delta */}
      <div
        className={`flex w-16 items-center justify-end gap-0.5 font-mono text-[10px] ${deltaColor}`}
      >
        <DeltaIcon size={10} />
        {job.delta === null ? (
          <span>—</span>
        ) : (
          <span>
            {job.delta > 0 ? "+" : ""}
            {formatDuration(Math.abs(job.delta))}
          </span>
        )}
      </div>
    </div>
  );
}
