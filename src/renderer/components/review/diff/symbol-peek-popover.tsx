import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FileCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const POPOVER_WIDTH = 360;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

interface SymbolPeekPopoverProps {
  symbol: string;
  anchor: { x: number; y: number };
  currentFile: string;
  onClose: () => void;
}

/**
 * Floating popover anchored at the cursor that shows matches for a symbol
 * across the working tree. Opens on ⌘-click over an identifier in the diff.
 */
export function SymbolPeekPopover({
  symbol,
  anchor,
  currentFile,
  onClose,
}: SymbolPeekPopoverProps) {
  const { cwd } = useWorkspace();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    globalThis.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      globalThis.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const grepQuery = useQuery({
    queryKey: ["git", "grepSymbol", cwd, symbol, currentFile],
    queryFn: () => {
      if (cwd === null) {
        throw new Error("Workspace path is unavailable");
      }
      return ipc("git.grepSymbol", { cwd, symbol, excludeFile: currentFile });
    },
    enabled: cwd !== null,
    staleTime: 60_000,
    retry: 0,
  });

  const position = clampPosition(anchor);

  return (
    <div
      ref={popoverRef}
      className="border-border-strong bg-bg-elevated fixed z-[60] flex flex-col overflow-hidden rounded-lg border"
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
        boxShadow: "var(--shadow-lg)",
      }}
      role="dialog"
      aria-label={`Peek symbol ${symbol}`}
    >
      <header className="border-border-subtle flex items-center gap-2 border-b px-3 py-2">
        <FileCode
          size={12}
          className="text-accent-text shrink-0"
          strokeWidth={2}
        />
        <span className="text-accent-text font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
          Peek
        </span>
        <span className="text-text-primary font-mono text-[12px]">{symbol}</span>
        <span className="text-text-ghost ml-auto font-mono text-[9px]">
          {grepQuery.data ? formatCount(grepQuery.data) : ""}
        </span>
      </header>

      <SymbolPeekBody
        query={grepQuery}
        symbol={symbol}
      />
    </div>
  );
}

function SymbolPeekBody({
  query,
  symbol,
}: {
  query: ReturnType<
    typeof useQuery<{
      matches: Array<{ file: string; line: number; snippet: string }>;
      total: number;
      truncated: boolean;
    }>
  >;
  symbol: string;
}) {
  if (query.isLoading) {
    return (
      <div className="text-text-secondary flex items-center gap-2 px-3 py-4 text-[11px]">
        <Spinner className="text-accent-text h-3 w-3" />
        <span>Scanning working tree for {symbol}…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="text-text-secondary px-3 py-3 text-[11px]">
        Could not grep the working tree. Is this folder a git repo?
      </div>
    );
  }

  const { data } = query;
  if (!data || data.matches.length === 0) {
    return (
      <div className="text-text-secondary px-3 py-3 text-[11px]">
        No other references to <span className="text-text-primary font-mono">{symbol}</span> in the
        working tree.
      </div>
    );
  }

  return (
    <ul className="flex-1 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
      {data.matches.map((match) => (
        <li key={`${match.file}:${match.line}`}>
          <MatchRow
            file={match.file}
            line={match.line}
            snippet={match.snippet}
            symbol={symbol}
          />
        </li>
      ))}
      {data.truncated && (
        <li className="text-text-tertiary px-3 py-2 font-mono text-[10px]">
          Showing first {data.matches.length} matches — refine your search for more
        </li>
      )}
    </ul>
  );
}

function MatchRow({
  file,
  line,
  snippet,
  symbol,
}: {
  file: string;
  line: number;
  snippet: string;
  symbol: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyReference = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(`${file}:${line}`);
      setCopied(true);
      toastManager.add({ title: "Copied reference", type: "success" });
      globalThis.setTimeout(() => setCopied(false), 1200);
    } catch {
      toastManager.add({ title: "Failed to copy", type: "error" });
    }
  };

  const fileParts = splitFilePath(file);

  return (
    <button
      type="button"
      onClick={copyReference}
      className="hover:bg-bg-raised group flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="text-text-tertiary truncate font-mono text-[10px]"
          title={file}
        >
          {fileParts.directory}
          <span className="text-text-primary">{fileParts.base}</span>
        </span>
        <span className="text-accent-text shrink-0 font-mono text-[10px]">:{line}</span>
        <span className="text-text-ghost group-hover:text-text-tertiary ml-auto shrink-0">
          {copied ? <Check size={10} /> : <Copy size={10} />}
        </span>
      </div>
      <code className="text-text-secondary block truncate font-mono text-[11px]">
        {renderSnippetWithHighlight(snippet, symbol)}
      </code>
    </button>
  );
}

function renderSnippetWithHighlight(snippet: string, symbol: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;
  for (const match of snippet.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: snippet.slice(lastIndex, index), highlight: false });
    }
    parts.push({ text: match[0], highlight: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < snippet.length) {
    parts.push({ text: snippet.slice(lastIndex), highlight: false });
  }
  return parts.map((part, index) =>
    part.highlight ? (
      <span
        key={index}
        className="text-accent-text bg-accent-muted -mx-px rounded-[2px] px-[1px]"
      >
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function splitFilePath(file: string): { directory: string; base: string } {
  const slashIndex = file.lastIndexOf("/");
  if (slashIndex === -1) {
    return { directory: "", base: file };
  }
  return {
    directory: file.slice(0, slashIndex + 1),
    base: file.slice(slashIndex + 1),
  };
}

function clampPosition(anchor: { x: number; y: number }): { top: number; left: number } {
  const { innerWidth, innerHeight } = globalThis;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, anchor.x + 8),
    innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
  );
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, anchor.y + 12),
    innerHeight - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN,
  );
  return { top, left };
}

function escapeRegExp(input: string): string {
  return input.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function formatCount(data: { total: number; truncated: boolean }): string {
  if (data.total === 0) {
    return "no matches";
  }
  return data.truncated
    ? `${data.total}+ matches`
    : `${data.total} match${data.total === 1 ? "" : "es"}`;
}
