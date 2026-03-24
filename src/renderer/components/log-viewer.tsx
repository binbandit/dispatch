import { Spinner } from "@/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ipc } from "../lib/ipc";

/**
 * CI Log viewer — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Fetches and renders CI logs with ANSI color parsing.
 * Collapsible group sections for GitHub Actions logs.
 * Supports search with match highlighting and navigation.
 */

interface LogViewerProps {
  cwd: string;
  runId: number;
  searchQuery?: string;
  activeMatchIndex?: number;
  onMatchCountChange?: (count: number) => void;
}

export function LogViewer({
  cwd,
  runId,
  searchQuery = "",
  activeMatchIndex = 0,
  onMatchCountChange,
}: LogViewerProps) {
  const logQuery = useQuery({
    queryKey: ["checks", "logs", cwd, runId],
    queryFn: () => ipc("checks.logs", { cwd, runId }),
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

  return (
    <LogContent
      raw={logQuery.data ?? ""}
      searchQuery={searchQuery}
      activeMatchIndex={activeMatchIndex}
      onMatchCountChange={onMatchCountChange}
    />
  );
}

function LogContent({
  raw,
  searchQuery,
  activeMatchIndex,
  onMatchCountChange,
}: {
  raw: string;
  searchQuery: string;
  activeMatchIndex: number;
  onMatchCountChange?: (count: number) => void;
}) {
  const sections = useMemo(() => parseLogSections(raw), [raw]);
  const activeMatchRef = useRef<HTMLSpanElement>(null);

  // Count total matches across all sections and report to parent
  const allLines = useMemo(() => {
    const lines: string[] = [];
    for (const section of sections) {
      for (const line of section.lines) {
        lines.push(line);
      }
    }
    return lines;
  }, [sections]);

  const matchCount = useMemo(() => {
    if (!searchQuery) {
      return 0;
    }
    const q = searchQuery.toLowerCase();
    let count = 0;
    for (const line of allLines) {
      // Strip ANSI codes for matching
      // eslint-disable-next-line no-control-regex
      const clean = line.replace(/\x1b\[\d+(?:;\d+)*m/g, "");
      const lower = clean.toLowerCase();
      let idx = lower.indexOf(q);
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(q, idx + 1);
      }
    }
    return count;
  }, [allLines, searchQuery]);

  // Notify parent of match count changes during render
  const prevMatchCountRef = useRef<number | undefined>(undefined);
  if (prevMatchCountRef.current !== matchCount) {
    prevMatchCountRef.current = matchCount;
    onMatchCountChange?.(matchCount);
  }

  // Scroll active match into view
  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex]);

  return (
    <div className="bg-bg-root max-h-[400px] overflow-y-auto rounded-md p-3">
      {sections.length === 0 && (
        <span className="text-text-tertiary text-[11px]">No log output</span>
      )}
      {sections.map((section, i) => (
        <LogSection
          key={`${section.name}-${i}`}
          section={section}
          searchQuery={searchQuery}
          activeMatchIndex={activeMatchIndex}
          activeMatchRef={activeMatchRef}
          globalOffset={computeSectionOffset(sections, i, searchQuery)}
        />
      ))}
    </div>
  );
}

/** Compute the global match offset for a section (how many matches come before it) */
function computeSectionOffset(
  sections: LogSectionData[],
  sectionIndex: number,
  query: string,
): number {
  let offset = 0;
  for (let i = 0; i < sectionIndex; i++) {
    const section = sections[i]!;
    for (const line of section.lines) {
      offset += countMatchesInLine(line, query);
    }
  }
  return offset;
}

function countMatchesInLine(line: string, query: string): number {
  if (!query) {
    return 0;
  }
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/\x1b\[\d+(?:;\d+)*m/g, "").toLowerCase();
  const q = query.toLowerCase();
  let count = 0;
  let idx = clean.indexOf(q);
  while (idx !== -1) {
    count++;
    idx = clean.indexOf(q, idx + 1);
  }
  return count;
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
      const lastSection = sections[sections.length - 1];
      if (lastSection && !lastSection.isGroup) {
        lastSection.lines.push(line);
      } else {
        sections.push({ name: "", lines: [line], isGroup: false });
      }
    }
  }

  if (currentGroup) {
    sections.push(currentGroup);
  }

  return sections;
}

function LogSection({
  section,
  searchQuery,
  activeMatchIndex,
  activeMatchRef,
  globalOffset,
}: {
  section: LogSectionData;
  searchQuery: string;
  activeMatchIndex: number;
  activeMatchRef: React.RefObject<HTMLSpanElement | null>;
  globalOffset: number;
}) {
  // Auto-expand sections that contain search matches
  const hasMatches = useMemo(() => {
    if (!searchQuery) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    return section.lines.some((line) => {
      // eslint-disable-next-line no-control-regex
      const clean = line.replace(/\x1b\[\d+(?:;\d+)*m/g, "").toLowerCase();
      return clean.includes(q);
    });
  }, [section.lines, searchQuery]);

  const defaultExpanded = !section.isGroup || hasMatches;
  const [expandedState, setExpandedState] = useState<boolean | null>(null);
  // Force-expand groups when search finds matches inside them,
  // regardless of user's manual collapsed state.
  const expanded = hasMatches && section.isGroup ? true : (expandedState ?? defaultExpanded);

  let lineMatchOffset = globalOffset;

  if (!section.isGroup) {
    return (
      <pre className="text-text-secondary font-mono text-[11px] leading-4">
        {section.lines.map((line, i) => {
          const matchesBefore = lineMatchOffset;
          lineMatchOffset += countMatchesInLine(line, searchQuery);
          return (
            <LogLine
              key={`${i}-${line.slice(0, 10)}`}
              text={line}
              searchQuery={searchQuery}
              matchOffset={matchesBefore}
              activeMatchIndex={activeMatchIndex}
              activeMatchRef={activeMatchRef}
            />
          );
        })}
      </pre>
    );
  }

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setExpandedState(!expanded)}
        className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-left"
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
        {hasMatches && !expanded && (
          <span className="bg-primary/20 text-primary ml-1 rounded-sm px-1 text-[9px]">
            matches
          </span>
        )}
      </button>
      {expanded && (
        <pre className="text-text-secondary ml-3 font-mono text-[11px] leading-4">
          {section.lines.map((line, i) => {
            const matchesBefore = lineMatchOffset;
            lineMatchOffset += countMatchesInLine(line, searchQuery);
            return (
              <LogLine
                key={`${i}-${line.slice(0, 10)}`}
                text={line}
                searchQuery={searchQuery}
                matchOffset={matchesBefore}
                activeMatchIndex={activeMatchIndex}
                activeMatchRef={activeMatchRef}
              />
            );
          })}
        </pre>
      )}
    </div>
  );
}

/**
 * Render a single log line with ANSI color + search highlighting.
 */
function LogLine({
  text,
  searchQuery,
  matchOffset,
  activeMatchIndex,
  activeMatchRef,
}: {
  text: string;
  searchQuery: string;
  matchOffset: number;
  activeMatchIndex: number;
  activeMatchRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const segments = useMemo(() => parseAnsi(text), [text]);

  if (!searchQuery) {
    return (
      <div className="min-h-4">
        {segments.map((seg, i) => (
          <span
            key={`${i}-${seg.text.slice(0, 5)}`}
            className={seg.className}
          >
            {seg.text}
          </span>
        ))}
        {"\n"}
      </div>
    );
  }

  // Highlight search matches within ANSI segments
  let globalMatchIdx = matchOffset;
  const q = searchQuery.toLowerCase();

  return (
    <div className="min-h-4">
      {segments.map((seg, i) => {
        const parts: React.ReactNode[] = [];
        let remaining = seg.text;
        let lower = remaining.toLowerCase();
        let matchPos = lower.indexOf(q);

        while (matchPos !== -1) {
          // Text before match
          if (matchPos > 0) {
            parts.push(
              <span
                key={`${i}-pre-${matchPos}`}
                className={seg.className}
              >
                {remaining.slice(0, matchPos)}
              </span>,
            );
          }
          // The match
          const isActive = globalMatchIdx === activeMatchIndex;
          parts.push(
            <span
              key={`${i}-match-${matchPos}`}
              ref={isActive ? activeMatchRef : undefined}
              className={`rounded-xs ${
                isActive ? "bg-primary text-bg-root" : "bg-warning/40 text-text-primary"
              }`}
            >
              {remaining.slice(matchPos, matchPos + q.length)}
            </span>,
          );
          globalMatchIdx++;
          remaining = remaining.slice(matchPos + q.length);
          lower = remaining.toLowerCase();
          matchPos = lower.indexOf(q);
        }

        // Remaining text after last match
        if (remaining) {
          parts.push(
            <span
              key={`${i}-rest`}
              className={seg.className}
            >
              {remaining}
            </span>,
          );
        }

        return parts;
      })}
      {"\n"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal ANSI parser
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
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), className: currentClass });
    }

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

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), className: currentClass });
  }

  if (segments.length === 0) {
    segments.push({ text, className: "" });
  }

  return segments;
}
