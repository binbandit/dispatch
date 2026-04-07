import type { GhWorkflowJobGraph, GhWorkflowRunJob } from "@/shared/ipc";

import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useMemo, useRef } from "react";

/**
 * Visual job dependency graph for a workflow run.
 *
 * Lays out jobs in columns by topological depth and renders SVG edges
 * between them to show the `needs` dependency structure.
 */

interface JobGraphViewProps {
  jobs: GhWorkflowRunJob[];
  graph: GhWorkflowJobGraph;
}

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: string;
  label: string;
  column: number;
  row: number;
  conclusion: string | null;
  status: string;
  duration: string;
}

interface LayoutEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 64;
const ROW_GAP = 20;
const PADDING_X = 24;
const PADDING_Y = 24;

function computeLayout(
  jobs: GhWorkflowRunJob[],
  graph: GhWorkflowJobGraph,
): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  const graphJobsById = new Map(graph.jobs.map((j) => [j.id, j]));

  // Map graph job IDs to actual run job names. GitHub Actions job names
  // Can differ from YAML keys (e.g. matrix expansions add a suffix).
  // Match by exact name first, then by prefix.
  const runJobsByName = new Map(jobs.map((j) => [j.name, j]));

  function findRunJob(graphId: string): GhWorkflowRunJob | undefined {
    const exact = runJobsByName.get(graphId);
    if (exact) {
      return exact;
    }

    // Matrix jobs: "build (node-18)" should match graph id "build"
    for (const [name, job] of runJobsByName) {
      if (name.startsWith(`${graphId} (`)) {
        return job;
      }
    }

    return undefined;
  }

  // Compute topological depth for each job
  const depths = new Map<string, number>();

  function getDepth(id: string): number {
    const cached = depths.get(id);
    if (cached !== undefined) {
      return cached;
    }

    const graphJob = graphJobsById.get(id);
    if (!graphJob || graphJob.needs.length === 0) {
      depths.set(id, 0);
      return 0;
    }

    const maxParentDepth = Math.max(...graphJob.needs.map(getDepth));
    const depth = maxParentDepth + 1;
    depths.set(id, depth);
    return depth;
  }

  // If the graph has no entries, lay out all run jobs in a single column
  const graphIds = graph.jobs.length > 0 ? graph.jobs.map((j) => j.id) : jobs.map((j) => j.name);

  for (const id of graphIds) {
    getDepth(id);
  }

  // Group by column (depth)
  const columns = new Map<number, string[]>();
  for (const id of graphIds) {
    const col = depths.get(id) ?? 0;
    const column = columns.get(col) ?? [];
    column.push(id);
    columns.set(col, column);
  }

  // Build layout nodes
  const nodes: LayoutNode[] = [];
  for (const [col, ids] of columns) {
    for (let row = 0; row < ids.length; row++) {
      const id = ids[row];
      if (id) {
        const runJob = findRunJob(id);
        nodes.push({
          id,
          label: runJob?.name ?? id,
          column: col,
          row,
          conclusion: runJob?.conclusion ?? null,
          status: runJob?.status ?? "queued",
          duration: runJob ? formatJobDuration(runJob) : "",
        });
      }
    }
  }

  // Build edges
  const edges: LayoutEdge[] = [];
  if (graph.jobs.length > 0) {
    for (const graphJob of graph.jobs) {
      for (const dep of graphJob.needs) {
        edges.push({ from: dep, to: graphJob.id });
      }
    }
  }

  const maxCol = Math.max(0, ...nodes.map((n) => n.column));
  const maxRowByCol = new Map<number, number>();
  for (const node of nodes) {
    const current = maxRowByCol.get(node.column) ?? 0;
    maxRowByCol.set(node.column, Math.max(current, node.row));
  }
  const maxRow = Math.max(0, ...maxRowByCol.values());

  const width = PADDING_X * 2 + (maxCol + 1) * NODE_WIDTH + maxCol * COLUMN_GAP;
  const height = PADDING_Y * 2 + (maxRow + 1) * NODE_HEIGHT + maxRow * ROW_GAP;

  return { nodes, edges, width, height };
}

function nodeX(column: number): number {
  return PADDING_X + column * (NODE_WIDTH + COLUMN_GAP);
}

function nodeY(row: number): number {
  return PADDING_Y + row * (NODE_HEIGHT + ROW_GAP);
}

function nodeCenterY(row: number): number {
  return nodeY(row) + NODE_HEIGHT / 2;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function resolveNodeStatus(conclusion: string | null, status: string) {
  if (conclusion === "success") {
    return {
      icon: CheckCircle2,
      color: "text-success",
      borderColor: "border-[rgba(61,214,140,0.3)]",
      bgColor: "bg-[rgba(61,214,140,0.06)]",
      spin: false,
    };
  }
  if (conclusion === "failure" || conclusion === "error") {
    return {
      icon: XCircle,
      color: "text-destructive",
      borderColor: "border-[rgba(239,100,97,0.3)]",
      bgColor: "bg-[rgba(239,100,97,0.06)]",
      spin: false,
    };
  }
  if (conclusion === "cancelled" || conclusion === "skipped") {
    return {
      icon: XCircle,
      color: "text-text-tertiary",
      borderColor: "border-border",
      bgColor: "bg-bg-raised",
      spin: false,
    };
  }
  if (status === "in_progress" || status === "queued") {
    return {
      icon: Loader2,
      color: "text-warning",
      borderColor: "border-[rgba(240,180,73,0.3)]",
      bgColor: "bg-[rgba(240,180,73,0.06)]",
      spin: true,
    };
  }
  return {
    icon: Loader2,
    color: "text-text-ghost",
    borderColor: "border-border",
    bgColor: "bg-bg-raised",
    spin: false,
  };
}

function resolveEdgeColor(conclusion: string | null): string {
  if (conclusion === "success") {
    return "rgba(61,214,140,0.4)";
  }
  if (conclusion === "failure" || conclusion === "error") {
    return "rgba(239,100,97,0.4)";
  }
  return "rgba(94,89,84,0.3)";
}

function formatJobDuration(job: GhWorkflowRunJob): string {
  if (!job.startedAt || !job.completedAt) {
    return "";
  }

  const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JobGraphView({ jobs, graph }: JobGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => computeLayout(jobs, graph), [jobs, graph]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  return (
    <div
      ref={containerRef}
      className="overflow-auto"
    >
      <div
        className="relative"
        style={{ width: layout.width, height: layout.height, minWidth: "100%" }}
      >
        {/* SVG edges */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={layout.width}
          height={layout.height}
        >
          {layout.edges.map((edge) => {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode) {
              return null;
            }

            const x1 = nodeX(fromNode.column) + NODE_WIDTH;
            const y1 = nodeCenterY(fromNode.row);
            const x2 = nodeX(toNode.column);
            const y2 = nodeCenterY(toNode.row);
            const midX = (x1 + x2) / 2;
            const edgeColor = resolveEdgeColor(fromNode.conclusion);

            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edgeColor}
                strokeWidth={2}
              />
            );
          })}
        </svg>

        {/* Job nodes */}
        {layout.nodes.map((node) => {
          const nodeStatus = resolveNodeStatus(node.conclusion, node.status);
          const StatusIcon = nodeStatus.icon;

          return (
            <div
              key={node.id}
              className={cn(
                "absolute flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                nodeStatus.borderColor,
                nodeStatus.bgColor,
              )}
              style={{
                left: nodeX(node.column),
                top: nodeY(node.row),
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
              }}
            >
              <StatusIcon
                size={16}
                className={cn("shrink-0", nodeStatus.color, nodeStatus.spin && "animate-spin")}
              />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate text-[11px] leading-tight font-medium">
                  {node.label}
                </p>
                {node.duration && (
                  <p className="text-text-tertiary mt-0.5 font-mono text-[9px]">{node.duration}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
