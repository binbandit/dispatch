import { Spinner } from "@/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { trpc } from "../lib/trpc";

/**
 * CI Log viewer — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Fetches and renders CI logs with ANSI color parsing.
 * Collapsible group sections for GitHub Actions logs.
 */

interface LogViewerProps {
  cwd: string;
  runId: number;
}

export function LogViewer({ cwd, runId }: LogViewerProps) {
  const logQuery = useQuery({
    ...trpc.checks.logs.queryOptions({ cwd, runId }),
    staleTime: 60_000,
    retry: 1,
  });

  if (logQuery.isLoading) {
    return (
      <div className="bg-bg-root flex items-center gap-2 rounded-md px-3 py-4">
        <Spinner className="text-text-tertiary h-3 w-3" />
        <span className="text-text-tertiary text-[11px]">Loading logs...</span>
      </div>
    );
  }

  if (logQuery.isError) {
    return (
      <div className="bg-bg-root text-text-tertiary rounded-md px-3 py-3 text-[11px]">
        Logs not available yet
      </div>
    );
  }

  return <LogContent raw={logQuery.data ?? ""} />;
}

function LogContent({ raw }: { raw: string }) {
  const sections = useMemo(() => parseLogSections(raw), [raw]);

  return (
    <div className="bg-bg-root max-h-[400px] overflow-y-auto rounded-md p-3">
      {sections.length === 0 && (
        <span className="text-text-tertiary text-[11px]">No log output</span>
      )}
      {sections.map((section, i) => (
        <LogSection
          key={`${section.name}-${i}`}
          section={section}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log section parsing
// ---------------------------------------------------------------------------

interface LogSectionData {
  name: string;
  lines: string[];
  isGroup: boolean;
}

function parseLogSections(raw: string): LogSectionData[] {
  const lines = raw.split("\n");
  const sections: LogSectionData[] = [];
  let currentGroup: LogSectionData | null = null;

  for (const line of lines) {
    // GitHub Actions group markers
    if (line.includes("##[group]")) {
      const name = line.replace(/.*##\[group\]/, "").trim();
      currentGroup = { name: name || "Group", lines: [], isGroup: true };
      continue;
    }
    if (line.includes("##[endgroup]")) {
      if (currentGroup) {
        sections.push(currentGroup);
        currentGroup = null;
      }
      continue;
    }

    if (currentGroup) {
      currentGroup.lines.push(line);
    } else {
      // Lines outside groups go into a default section
      const lastSection = sections[sections.length - 1];
      if (lastSection && !lastSection.isGroup) {
        lastSection.lines.push(line);
      } else {
        sections.push({ name: "", lines: [line], isGroup: false });
      }
    }
  }

  // Close any unclosed group
  if (currentGroup) {
    sections.push(currentGroup);
  }

  return sections;
}

function LogSection({ section }: { section: LogSectionData }) {
  const [expanded, setExpanded] = useState(!section.isGroup);

  if (!section.isGroup) {
    return (
      <pre className="text-text-secondary font-mono text-[11px] leading-4">
        {section.lines.map((line, i) => (
          <LogLine
            key={i}
            text={line}
          />
        ))}
      </pre>
    );
  }

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-bg-raised flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left"
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
        <span className="text-text-primary font-mono text-[11px] font-medium">{section.name}</span>
      </button>
      {expanded && (
        <pre className="text-text-secondary ml-3 font-mono text-[11px] leading-4">
          {section.lines.map((line, i) => (
            <LogLine
              key={i}
              text={line}
            />
          ))}
        </pre>
      )}
    </div>
  );
}

/**
 * Render a single log line with basic ANSI color support.
 * Strips ANSI codes and applies color classes.
 */
function LogLine({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);

  return (
    <div className="min-h-4">
      {segments.map((seg, i) => (
        <span
          key={i}
          className={seg.className}
        >
          {seg.text}
        </span>
      ))}
      {"\n"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal ANSI parser (no external deps)
// ---------------------------------------------------------------------------

interface AnsiSegment {
  text: string;
  className: string;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: "text-text-primary",
  31: "text-destructive",
  32: "text-success",
  33: "text-warning",
  34: "text-info",
  35: "text-purple",
  36: "text-info",
  37: "text-text-primary",
  90: "text-text-tertiary",
  91: "text-destructive",
  92: "text-success",
  93: "text-warning",
  94: "text-info",
  95: "text-purple",
  96: "text-info",
  97: "text-text-primary",
};

function parseAnsi(text: string): AnsiSegment[] {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\x1b\[(\d+(?:;\d+)*)m/g;
  const segments: AnsiSegment[] = [];
  let lastIndex = 0;
  let currentClass = "";

  let match: RegExpExecArray | null = ansiRegex.exec(text);
  while (match !== null) {
    // Text before this escape
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), className: currentClass });
    }

    // Parse codes
    const codes = match[1]?.split(";").map(Number) ?? [];
    for (const code of codes) {
      if (code === 0) {
        currentClass = "";
      } else if (code === 1) {
        currentClass = `${currentClass} font-bold`.trim();
      } else if (code === 2) {
        currentClass = `${currentClass} opacity-60`.trim();
      } else if (ANSI_COLOR_MAP[code]) {
        currentClass = ANSI_COLOR_MAP[code] ?? "";
      }
    }

    lastIndex = match.index + match[0].length;
    match = ansiRegex.exec(text);
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), className: currentClass });
  }

  if (segments.length === 0) {
    segments.push({ text, className: "" });
  }

  return segments;
}
