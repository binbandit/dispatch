import type { GhWorkflowRunJob, RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { resolveStatusIcon } from "./job-row";
import { parseAnsi, parseLogSections, type LogSectionData } from "./log-viewer";

/**
 * Per-step accordion — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Renders a job's steps as a flat list, each row expandable to reveal the
 * log lines emitted by that step. Step/section matching is by display name.
 */

interface JobStepsAccordionProps {
  repoTarget: RepoTarget;
  runId: number;
  steps: readonly GhWorkflowRunJob["steps"][number][];
}

export function JobStepsAccordion({ repoTarget, runId, steps }: JobStepsAccordionProps) {
  const logQuery = useQuery({
    queryKey: ["checks", "logs", repoTarget.owner, repoTarget.repo, runId],
    queryFn: () => ipc("checks.logs", { ...repoTarget, runId }),
    staleTime: 60_000,
    retry: 1,
  });

  const sectionsByName = useMemo(() => {
    const map = new Map<string, LogSectionData>();
    if (!logQuery.data) {
      return map;
    }
    for (const section of parseLogSections(logQuery.data)) {
      if (section.isGroup && section.name) {
        map.set(normalizeSectionName(section.name), section);
      }
    }
    return map;
  }, [logQuery.data]);

  return (
    <div className="flex flex-col">
      {steps.map((step) => (
        <StepRow
          key={step.number}
          step={step}
          section={sectionsByName.get(normalizeSectionName(step.name))}
          logsLoading={logQuery.isLoading}
        />
      ))}
    </div>
  );
}

function StepRow({
  step,
  section,
  logsLoading,
}: {
  step: GhWorkflowRunJob["steps"][number];
  section: LogSectionData | undefined;
  logsLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = resolveStatusIcon(step.conclusion, step.status);
  const expandable = logsLoading || Boolean(section && section.lines.length > 0);

  return (
    <div className="border-border-subtle border-b last:border-b-0">
      <div
        className={`flex items-center gap-2 px-2 py-1.5 ${
          expanded ? "bg-bg-raised" : expandable ? "hover:bg-bg-raised" : ""
        }`}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown
                size={11}
                className="text-text-tertiary shrink-0"
              />
            ) : (
              <ChevronRight
                size={11}
                className="text-text-tertiary shrink-0"
              />
            )}
            <statusIcon.icon
              size={12}
              className={`shrink-0 ${statusIcon.color} ${statusIcon.spin ? "animate-spin" : ""}`}
            />
            <span className="text-text-secondary min-w-0 flex-1 truncate text-[11px]">
              {step.name}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-[15px]">
            <statusIcon.icon
              size={12}
              className={`shrink-0 ${statusIcon.color} ${statusIcon.spin ? "animate-spin" : ""}`}
            />
            <span className="text-text-secondary min-w-0 flex-1 truncate text-[11px]">
              {step.name}
            </span>
          </div>
        )}
      </div>
      {expanded && (
        <div className="bg-bg-root px-2 py-2">
          {section ? (
            <LogLinesPane lines={section.lines} />
          ) : logsLoading ? (
            <div className="flex items-center gap-2 px-1 py-1">
              <Spinner className="text-text-tertiary h-3 w-3" />
              <span className="text-text-tertiary text-[11px]">Loading logs…</span>
            </div>
          ) : (
            <span className="text-text-tertiary px-1 text-[11px]">No logs for this step</span>
          )}
        </div>
      )}
    </div>
  );
}

function LogLinesPane({ lines }: { lines: readonly string[] }) {
  return (
    <div className="max-h-[360px] overflow-y-auto rounded-md">
      <table className="w-full text-[11px]">
        <tbody>
          {lines.map((line, index) => (
            <LogLinePlain
              key={`${index}-${line.slice(0, 8)}`}
              lineNumber={index + 1}
              text={line}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogLinePlain({ lineNumber, text }: { lineNumber: number; text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);
  return (
    <tr className="hover:bg-bg-raised/40">
      <td className="text-text-tertiary w-8 px-0 py-0 text-right font-mono text-[10px] tabular-nums select-none">
        {lineNumber}
      </td>
      <td className="px-0 py-0">
        <pre className="font-mono text-[11px] break-all whitespace-pre-wrap">
          {segments.map((seg, i) => (
            <span
              key={`${i}-${seg.text.slice(0, 5)}`}
              className={seg.className}
            >
              {seg.text}
            </span>
          ))}
        </pre>
      </td>
    </tr>
  );
}

function normalizeSectionName(name: string): string {
  return name.trim().toLowerCase();
}
