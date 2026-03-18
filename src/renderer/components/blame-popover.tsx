import { relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Blame-on-hover popover — DISPATCH-DESIGN-SYSTEM.md § 8.10
 *
 * Shows git blame info when hovering a diff line for 500ms.
 * - Background: --bg-elevated
 * - Border: 1px solid --border-strong
 * - Shadow: --shadow-md
 */

interface BlamePopoverProps {
  file: string;
  line: number | null;
  gitRef: string;
  anchorRect: { top: number; left: number } | null;
}

export function BlamePopover({ file, line, gitRef, anchorRect }: BlamePopoverProps) {
  const { cwd } = useWorkspace();

  const blameQuery = useQuery({
    queryKey: ["git", "blame", cwd, file, line, gitRef],
    queryFn: () => ipc("git.blame", { cwd, file, line: line ?? 1, ref: gitRef }),
    enabled: line !== null && line > 0,
    staleTime: 300_000, // Cache blame results for 5 minutes
    retry: 0,
  });

  if (!anchorRect || !line || blameQuery.isLoading || blameQuery.isError || !blameQuery.data) {
    return null;
  }

  const blame = blameQuery.data;

  return (
    <div
      className="border-border-strong bg-bg-elevated pointer-events-none fixed z-50 rounded-md border p-2 shadow-md"
      style={{
        top: anchorRect.top - 60,
        left: anchorRect.left + 80,
        maxWidth: 320,
      }}
    >
      <div className="flex items-center gap-2">
        {/* Author avatar */}
        <div
          className="text-bg-root flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
          style={{ background: "linear-gradient(135deg, var(--primary), #7c5a2a)" }}
        >
          {blame.author[0]?.toUpperCase() ?? "?"}
        </div>
        <span className="text-text-primary text-[11px] font-medium">{blame.author}</span>
        <span className="text-text-tertiary font-mono text-[10px]">
          {relativeTime(new Date(blame.date))}
        </span>
      </div>
      <p className="text-text-secondary mt-1 max-w-[280px] truncate text-[11px]">{blame.summary}</p>
      <p className="text-text-ghost mt-0.5 font-mono text-[9px]">{blame.sha.slice(0, 8)}</p>
    </div>
  );
}

/**
 * Hook to track which diff line is being hovered for blame.
 * Returns the hovered line number and anchor position.
 * Debounces at 500ms.
 */
export function useBlameHover() {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLineEnter = useCallback((lineNumber: number, rect: { top: number; left: number }) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setHoveredLine(lineNumber);
      setAnchorRect(rect);
    }, 500);
  }, []);

  const onLineLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHoveredLine(null);
    setAnchorRect(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { hoveredLine, anchorRect, onLineEnter, onLineLeave };
}
