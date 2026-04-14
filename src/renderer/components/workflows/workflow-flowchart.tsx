import type { GhWorkflowJobGraphNode, GhWorkflowRunJob, RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlowchartNode {
  id: string;
  needs: string[];
  layer: number;
  laneIndex: number;
  status: string | null;
  conclusion: string | null;
  duration: string;
}

interface FlowchartEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 180;
const NODE_HEIGHT = 52;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 28;
const PADDING_X = 32;
const PADDING_Y = 28;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WorkflowFlowchartProps {
  repoTarget: RepoTarget;
  workflowId: string | null;
  jobs: GhWorkflowRunJob[];
}

export function WorkflowFlowchart({ repoTarget, workflowId, jobs }: WorkflowFlowchartProps) {
  const graphQuery = useQuery({
    queryKey: ["workflows", "jobGraph", repoTarget.owner, repoTarget.repo, workflowId],
    queryFn: () => {
      if (!workflowId) {
        return Promise.resolve({ jobs: [] });
      }
      return ipc("workflows.jobGraph", { ...repoTarget, workflowId });
    },
    enabled: Boolean(workflowId),
    staleTime: 60_000,
  });

  const { nodes, nodeMap, edges, width, height } = useMemo(() => {
    const graphJobs = graphQuery.data?.jobs ?? [];
    return computeLayout(graphJobs, jobs);
  }, [graphQuery.data, jobs]);

  if (!workflowId) {
    return (
      <div className="text-text-tertiary flex items-center justify-center px-4 py-12 text-xs">
        Workflow not found — cannot render flowchart
      </div>
    );
  }

  if (graphQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  if (graphQuery.isError || nodes.length === 0) {
    return (
      <div className="text-text-tertiary flex items-center justify-center px-4 py-12 text-xs">
        {graphQuery.isError
          ? "Failed to load workflow graph"
          : "No jobs found in workflow definition"}
      </div>
    );
  }

  return (
    <div className="overflow-auto px-4 py-3">
      <svg
        width={width}
        height={height}
        className="block"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              style={{ fill: "var(--border-strong)" }}
            />
          </marker>
        </defs>

        {edges.map((edge) => {
          const fromNode = nodeMap.get(edge.from);
          const toNode = nodeMap.get(edge.to);
          if (!fromNode || !toNode) {
            return null;
          }
          return (
            <FlowchartEdgePath
              key={`${edge.from}->${edge.to}`}
              from={fromNode}
              to={toNode}
            />
          );
        })}

        {nodes.map((node) => (
          <FlowchartNodeBox
            key={node.id}
            node={node}
          />
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node component
// ---------------------------------------------------------------------------

function FlowchartNodeBox({ node }: { node: FlowchartNode }) {
  const x = PADDING_X + node.layer * (NODE_WIDTH + HORIZONTAL_GAP);
  const y = PADDING_Y + node.laneIndex * (NODE_HEIGHT + VERTICAL_GAP);

  const style = resolveNodeStyle(node.conclusion, node.status);

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        ry={6}
        style={{ fill: style.bgColor, stroke: style.borderColor }}
        strokeWidth={1.5}
      />

      <foreignObject
        x={10}
        y={(NODE_HEIGHT - 16) / 2}
        width={16}
        height={16}
      >
        <style.icon
          size={14}
          className={`${style.iconColor} ${style.iconSpin ? "animate-spin" : ""}`}
        />
      </foreignObject>

      <foreignObject
        x={30}
        y={8}
        width={NODE_WIDTH - 40}
        height={20}
      >
        <p
          className="text-text-primary truncate text-[11px] font-medium"
          title={node.id}
        >
          {node.id}
        </p>
      </foreignObject>

      <foreignObject
        x={30}
        y={26}
        width={NODE_WIDTH - 40}
        height={18}
      >
        <p className="text-text-tertiary truncate font-mono text-[10px]">{node.duration}</p>
      </foreignObject>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Edge component
// ---------------------------------------------------------------------------

function FlowchartEdgePath({ from, to }: { from: FlowchartNode; to: FlowchartNode }) {
  const x1 = PADDING_X + from.layer * (NODE_WIDTH + HORIZONTAL_GAP) + NODE_WIDTH;
  const y1 = PADDING_Y + from.laneIndex * (NODE_HEIGHT + VERTICAL_GAP) + NODE_HEIGHT / 2;
  const x2 = PADDING_X + to.layer * (NODE_WIDTH + HORIZONTAL_GAP);
  const y2 = PADDING_Y + to.laneIndex * (NODE_HEIGHT + VERTICAL_GAP) + NODE_HEIGHT / 2;

  // Bezier curve for smooth connection
  const midX = (x1 + x2) / 2;

  return (
    <path
      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
      fill="none"
      style={{ stroke: "var(--border-strong)" }}
      strokeWidth={1.5}
      markerEnd="url(#arrowhead)"
    />
  );
}

// ---------------------------------------------------------------------------
// DAG layout algorithm
// ---------------------------------------------------------------------------

function computeLayout(
  graphJobs: GhWorkflowJobGraphNode[],
  runtimeJobs: GhWorkflowRunJob[],
): {
  nodes: FlowchartNode[];
  nodeMap: Map<string, FlowchartNode>;
  edges: FlowchartEdge[];
  width: number;
  height: number;
} {
  if (graphJobs.length === 0) {
    return { nodes: [], nodeMap: new Map(), edges: [], width: 0, height: 0 };
  }

  // Build runtime lookup maps. GitHub Actions job names in the runtime API
  // Often differ from the YAML job IDs (the YAML key is "build" but the run
  // Shows "Build"), so we try exact → case-insensitive → substring.
  const runtimeByName = new Map<string, GhWorkflowRunJob>();
  const runtimeByLower = new Map<string, GhWorkflowRunJob>();
  for (const runtimeJob of runtimeJobs) {
    runtimeByName.set(runtimeJob.name, runtimeJob);
    const lower = runtimeJob.name.toLowerCase();
    if (!runtimeByLower.has(lower)) {
      runtimeByLower.set(lower, runtimeJob);
    }
  }

  function findRuntimeJob(jobId: string): GhWorkflowRunJob | undefined {
    const exact = runtimeByName.get(jobId);
    if (exact) {
      return exact;
    }

    const lower = jobId.toLowerCase();
    const caseInsensitive = runtimeByLower.get(lower);
    if (caseInsensitive) {
      return caseInsensitive;
    }

    // Substring match (YAML id contained in runtime name or vice versa)
    for (const [name, job] of runtimeByName) {
      if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) {
        return job;
      }
    }

    return undefined;
  }

  // Assign layers via longest-path algorithm (topological layering)
  const jobMap = new Map(graphJobs.map((j) => [j.id, j]));
  const layerCache = new Map<string, number>();

  function getLayer(jobId: string): number {
    const cached = layerCache.get(jobId);
    if (cached !== undefined) {
      return cached;
    }

    const job = jobMap.get(jobId);
    if (!job || job.needs.length === 0) {
      layerCache.set(jobId, 0);
      return 0;
    }

    const maxParentLayer = Math.max(...job.needs.map(getLayer));
    const layer = maxParentLayer + 1;
    layerCache.set(jobId, layer);
    return layer;
  }

  for (const job of graphJobs) {
    getLayer(job.id);
  }

  // Group jobs by layer
  const layerGroups = new Map<number, string[]>();
  for (const job of graphJobs) {
    const layer = layerCache.get(job.id) ?? 0;
    const group = layerGroups.get(layer) ?? [];
    group.push(job.id);
    layerGroups.set(layer, group);
  }

  // Assign lane index within each layer
  const laneMap = new Map<string, number>();
  for (const [, group] of layerGroups) {
    group.forEach((jobId, index) => laneMap.set(jobId, index));
  }

  // Build nodes
  const nodes: FlowchartNode[] = graphJobs.map((graphJob) => {
    const runtime = findRuntimeJob(graphJob.id);
    return {
      id: graphJob.id,
      needs: graphJob.needs,
      layer: layerCache.get(graphJob.id) ?? 0,
      laneIndex: laneMap.get(graphJob.id) ?? 0,
      status: runtime?.status ?? null,
      conclusion: runtime?.conclusion ?? null,
      duration: runtime ? computeDuration(runtime) : "pending",
    };
  });

  // Build edges
  const edges: FlowchartEdge[] = [];
  for (const job of graphJobs) {
    for (const dep of job.needs) {
      edges.push({ from: dep, to: job.id });
    }
  }

  // Build node lookup map for O(1) edge resolution
  const nodeMap = new Map<string, FlowchartNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Compute canvas size
  const maxLayer = Math.max(...nodes.map((n) => n.layer));
  const maxLane = Math.max(...nodes.map((n) => n.laneIndex));
  const width = PADDING_X * 2 + (maxLayer + 1) * NODE_WIDTH + maxLayer * HORIZONTAL_GAP;
  const height = PADDING_Y * 2 + (maxLane + 1) * NODE_HEIGHT + maxLane * VERTICAL_GAP;

  return { nodes, nodeMap, edges, width, height };
}

// ---------------------------------------------------------------------------
// Node styling — single decision tree for all visual properties
// ---------------------------------------------------------------------------

function resolveNodeStyle(conclusion: string | null, status: string | null) {
  if (conclusion === "success") {
    return {
      borderColor: "var(--success)",
      bgColor: "var(--success-muted)",
      icon: CheckCircle2,
      iconColor: "text-success",
      iconSpin: false,
    };
  }
  if (conclusion === "failure" || conclusion === "error") {
    return {
      borderColor: "var(--destructive)",
      bgColor: "var(--danger-muted)",
      icon: XCircle,
      iconColor: "text-destructive",
      iconSpin: false,
    };
  }
  if (conclusion === "cancelled" || conclusion === "skipped") {
    return {
      borderColor: "var(--border)",
      bgColor: "var(--bg-raised)",
      icon: XCircle,
      iconColor: "text-text-tertiary",
      iconSpin: false,
    };
  }
  if (status === "in_progress" || status === "queued") {
    return {
      borderColor: "var(--warning)",
      bgColor: "var(--warning-muted)",
      icon: Loader2,
      iconColor: "text-warning",
      iconSpin: true,
    };
  }
  return {
    borderColor: "var(--border)",
    bgColor: "var(--bg-raised)",
    icon: Circle,
    iconColor: "text-text-ghost",
    iconSpin: false,
  };
}

function computeDuration(job: GhWorkflowRunJob): string {
  if (!job.startedAt || !job.completedAt) {
    return "running";
  }
  const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
