import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from "react";

/**
 * CI Log viewer — DISPATCH-DESIGN-SYSTEM.md § 8.7
 *
 * Fetches and renders CI logs with ANSI color parsing.
 * Collapsible group sections for GitHub Actions logs.
 * Supports search with match highlighting and navigation.
 */

export interface LogViewerProps {
  repoTarget: RepoTarget;
  runId: number;
  searchQuery?: string;
  activeMatchIndex?: number;
  onMatchCountChange?: (count: number) => void;
}

const LOG_SECTION_PREVIEW_LIMIT = 200;

export function LogViewer({
  repoTarget,
  runId,
  searchQuery = "",
  activeMatchIndex = 0,
  onMatchCountChange,
}: LogViewerProps) {
  const logQuery = useQuery({
    queryKey: ["checks", "logs", repoTarget.owner, repoTarget.repo, runId],
    queryFn: () => ipc("checks.logs", { ...repoTarget, runId }),
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

  const sectionRenderData = useMemo(() => {
    const result: LogSectionRenderData[] = [];
    let cursorLine = 1;
    let cursorMatch = 0;

    for (const section of sections) {
      const sectionMatchOffset = cursorMatch;
      let sectionMatchCount = 0;
      for (const line of section.lines) {
        sectionMatchCount += countMatchesInLine(line, searchQuery);
      }
      cursorMatch += sectionMatchCount;

      const sectionLineCount = section.lines.length + (section.isGroup ? 1 : 0);
      result.push({
        section,
        startLine: cursorLine,
        matchOffset: sectionMatchOffset,
      });

      cursorLine += sectionLineCount;
    }

    return result;
  }, [sections, searchQuery]);

  const allLines = useMemo(() => {
    const lines: string[] = [];
    for (const { section } of sectionRenderData) {
      for (const line of section.lines) {
        lines.push(line);
      }
    }
    return lines;
  }, [sectionRenderData]);

  const matchCount = useMemo(() => {
    if (!searchQuery) {
      return 0;
    }
    let count = 0;
    for (const line of allLines) {
      // Strip ANSI codes for matching
      // eslint-disable-next-line no-control-regex
      const clean = line.replaceAll(/\u001B\[\d+(?:;\d+)*m/g, "");
      const lower = clean.toLowerCase();
      const q = searchQuery.toLowerCase();
      let idx = lower.indexOf(q);
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(q, idx + 1);
      }
    }
    return count;
  }, [allLines, searchQuery]);

  useEffect(() => {
    onMatchCountChange?.(matchCount);
  }, [matchCount, onMatchCountChange]);

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex]);

  if (sectionRenderData.length === 0) {
    return (
      <div className="bg-bg-root rounded-md px-3 py-2">
        <span className="text-text-tertiary text-[11px]">No log output</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {sectionRenderData.map(({ section, startLine, matchOffset }, index) => (
        <LogSection
          key={`${section.name}-${index}`}
          section={section}
          startLine={startLine}
          searchQuery={searchQuery}
          activeMatchIndex={activeMatchIndex}
          activeMatchRef={activeMatchRef}
          matchOffset={matchOffset}
        />
      ))}
    </div>
  );
}

function LogSection({
  section,
  startLine,
  searchQuery,
  activeMatchIndex,
  activeMatchRef,
  matchOffset,
}: {
  section: LogSectionData;
  startLine: number;
  searchQuery: string;
  activeMatchIndex: number;
  activeMatchRef: RefObject<HTMLSpanElement | null>;
  matchOffset: number;
}) {
  const hasMatches = useMemo(() => {
    if (!searchQuery) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    return section.lines.some((line) => {
      // eslint-disable-next-line no-control-regex
      const clean = line.replaceAll(/\u001B\[\d+(?:;\d+)*m/g, "").toLowerCase();
      return clean.includes(q);
    });
  }, [section.lines, searchQuery]);

  const isLong = section.lines.length > LOG_SECTION_PREVIEW_LIMIT;
  const defaultExpanded = section.name.toLowerCase().startsWith("run ") || !isLong;
  const [expandedState, setExpandedState] = useState<boolean | null>(null);
  const [isShowingAllLines, setIsShowingAllLines] = useState(false);

  const expanded = hasMatches ? true : (expandedState ?? defaultExpanded);

  useEffect(() => {
    setIsShowingAllLines(false);
  }, [expanded, section.name, searchQuery]);

  const linesToRender = useMemo(() => {
    if (section.isGroup && expanded && !hasMatches && isLong && !isShowingAllLines) {
      return section.lines.slice(0, LOG_SECTION_PREVIEW_LIMIT);
    }
    return section.lines;
  }, [expanded, hasMatches, isLong, isShowingAllLines, section]);

  const hiddenLineCount = section.lines.length - linesToRender.length;

  const renderedRows = useMemo(() => {
    let lineMatchCursor = 0;
    return linesToRender.map((line, lineIndex) => {
      const rowLine = section.isGroup ? startLine + 1 + lineIndex : startLine + lineIndex;
      const matchesBefore = matchOffset + lineMatchCursor;
      lineMatchCursor += countMatchesInLine(line, searchQuery);
      return (
        <LogLineRow
          key={`${startLine}-line-${lineIndex}`}
          lineNumber={rowLine}
          text={line}
          searchQuery={searchQuery}
          matchOffset={matchesBefore}
          activeMatchIndex={activeMatchIndex}
          activeMatchRef={activeMatchRef}
        />
      );
    });
  }, [
    activeMatchIndex,
    activeMatchRef,
    linesToRender,
    matchOffset,
    searchQuery,
    section.isGroup,
    startLine,
  ]);

  if (!section.isGroup) {
    return (
      <div className="bg-bg-root rounded-md px-3 py-2">
        <table className="w-full text-[11px]">
          <tbody>{renderedRows}</tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="bg-bg-root overflow-hidden rounded-md">
      <button
        type="button"
        onClick={() => setExpandedState((prev) => !prev)}
        className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-1 px-2.5 py-1.5 text-left"
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
        {hasMatches && (
          <span className="bg-primary/20 text-primary ml-1 rounded-sm px-1 text-[9px]">
            matches
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-border-subtle border-t px-3 py-2">
          <table className="w-full text-[11px]">
            <tbody>
              {renderedRows}
              {section.lines.length > LOG_SECTION_PREVIEW_LIMIT &&
                !hasMatches &&
                (isShowingAllLines ? (
                  <tr>
                    <td className="text-text-tertiary w-8 pt-1 text-right align-top font-mono text-[10px] select-none">
                      {startLine + section.lines.length}
                    </td>
                    <td className="px-0 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsShowingAllLines(false)}
                        className="hover:bg-bg-raised text-text-tertiary rounded px-2 py-0.5 text-left"
                      >
                        Show fewer lines
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td className="text-text-tertiary w-8 pt-1 text-right align-top font-mono text-[10px] select-none">
                      {startLine + 1 + linesToRender.length}
                    </td>
                    <td className="px-0 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsShowingAllLines(true)}
                        className="hover:bg-bg-raised text-text-tertiary rounded px-2 py-0.5 text-left"
                      >
                        Show all {section.lines.length} lines ({hiddenLineCount} more)
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogLineRow({
  lineNumber,
  text,
  searchQuery,
  matchOffset,
  activeMatchIndex,
  activeMatchRef,
}: {
  lineNumber: number;
  text: string;
  searchQuery: string;
  matchOffset: number;
  activeMatchIndex: number;
  activeMatchRef: RefObject<HTMLSpanElement | null>;
}) {
  const segments = useMemo(() => parseAnsi(text), [text]);
  const rowSeverity = getLineSeverity(segments);
  const rowClass =
    rowSeverity === "error"
      ? "bg-destructive/10"
      : rowSeverity === "warning"
        ? "bg-warning/10"
        : "hover:bg-bg-raised/40";

  if (!searchQuery) {
    return (
      <tr className={rowClass}>
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

  let globalMatchIdx = matchOffset;
  const q = searchQuery.toLowerCase();

  return (
    <tr className={rowClass}>
      <td className="text-text-tertiary w-8 px-0 py-0 text-right font-mono text-[10px] tabular-nums select-none">
        {lineNumber}
      </td>
      <td className="px-0 py-0">
        <pre className="font-mono text-[11px] break-all whitespace-pre-wrap">
          {segments.map((seg, i) => {
            const parts: ReactNode[] = [];
            let remaining = seg.text;
            let lower = remaining.toLowerCase();
            let matchPos = lower.indexOf(q);

            while (matchPos !== -1) {
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
        </pre>
      </td>
    </tr>
  );
}

export interface LogSectionData {
  name: string;
  lines: string[];
  isGroup: boolean;
}

interface LogSectionRenderData {
  section: LogSectionData;
  startLine: number;
  matchOffset: number;
}

export function parseLogSections(raw: string): LogSectionData[] {
  const lines = raw.split("\n");
  const sections: LogSectionData[] = [];
  let currentGroup: LogSectionData | null = null;
  let currentUngrouped: LogSectionData | null = null;

  for (const line of lines) {
    if (line.includes("##[group]")) {
      if (currentUngrouped && currentUngrouped.lines.length > 0) {
        sections.push(currentUngrouped);
        currentUngrouped = null;
      }
      const name = line.replace(/.*##\[group\]/, "").trim();
      if (currentGroup) {
        sections.push(currentGroup);
      }
      currentGroup = { name: name || "Group", lines: [], isGroup: true };
    } else if (line.includes("##[endgroup]")) {
      if (currentGroup) {
        sections.push(currentGroup);
        currentGroup = null;
      }
    } else if (currentGroup) {
      currentGroup.lines.push(line);
    } else {
      if (!currentUngrouped) {
        currentUngrouped = { name: "", lines: [], isGroup: false };
      }
      currentUngrouped.lines.push(line);
    }
  }

  if (currentGroup) {
    sections.push(currentGroup);
  }
  if (currentUngrouped && currentUngrouped.lines.length > 0) {
    sections.push(currentUngrouped);
  }

  return sections;
}

function countMatchesInLine(line: string, query: string): number {
  if (!query) {
    return 0;
  }
  // eslint-disable-next-line no-control-regex
  const clean = line.replaceAll(/\u001B\[\d+(?:;\d+)*m/g, "").toLowerCase();
  const q = query.toLowerCase();
  let count = 0;
  let idx = clean.indexOf(q);
  while (idx !== -1) {
    count++;
    idx = clean.indexOf(q, idx + 1);
  }
  return count;
}

function getLineSeverity(segments: AnsiSegment[]): "error" | "warning" | "default" {
  const hasError = segments.some((segment) => segment.className.includes("text-destructive"));
  if (hasError) {
    return "error";
  }
  const hasWarning = segments.some((segment) => segment.className.includes("text-warning"));
  if (hasWarning) {
    return "warning";
  }
  return "default";
}

export interface AnsiSegment {
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

export function parseAnsi(text: string): AnsiSegment[] {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\u001B\[(\d+(?:;\d+)*)m/g;
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
