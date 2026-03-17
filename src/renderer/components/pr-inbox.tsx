import { useCallback, useEffect, useState } from "react";

import { Search } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";

/**
 * PR Inbox sidebar matching DISPATCH-DESIGN-SYSTEM.md § 8.4:
 *
 * - Width: 260px, background: --bg-surface, border-right: 1px solid --border
 * - Keyboard-navigable list (vim bindings: j/k)
 * - Sections: "Needs your review", "Your pull requests"
 */

interface PrInboxProps {
  selectedPr: number | null;
  onSelectPr: (pr: number) => void;
}

// Placeholder PR data for the shell
const PLACEHOLDER_PRS = [
  { number: 42, title: "Add CI/CD pipeline integration", author: "alice", status: "success", updatedAt: "2m ago" },
  { number: 41, title: "Fix diff viewer scroll performance", author: "bob", status: "failure", updatedAt: "15m ago" },
  { number: 40, title: "Implement blame-on-hover feature", author: "carol", status: "pending", updatedAt: "1h ago" },
  { number: 39, title: "Update Tailwind to v4", author: "dave", status: "success", updatedAt: "3h ago" },
];

const STATUS_COLORS: Record<string, string> = {
  success: "bg-success",
  failure: "bg-destructive",
  pending: "bg-warning",
};

export function PrInbox({ selectedPr, onSelectPr }: PrInboxProps) {
  const [focusIndex, setFocusIndex] = useState(0);

  // Vim-style keyboard navigation (j/k)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "j") {
        setFocusIndex((i) => Math.min(i + 1, PLACEHOLDER_PRS.length - 1));
      } else if (event.key === "k") {
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        const pr = PLACEHOLDER_PRS[focusIndex];
        if (pr) {
          onSelectPr(pr.number);
        }
      }
    },
    [focusIndex, onSelectPr],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-surface">
      {/* Header (§ 8.4 Header) */}
      <div className="px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Pull Requests
        </h2>
      </div>

      {/* Search box (§ 8.4 Search box) */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-raised px-2 py-1.5">
          <Search size={13} className="shrink-0 text-text-tertiary" />
          <span className="flex-1 text-xs text-text-tertiary">Search PRs...</span>
          <Kbd>/</Kbd>
        </div>
      </div>

      {/* PR list */}
      <div className="flex-1 overflow-y-auto">
        {/* Section: Needs your review (§ 8.4 Section labels) */}
        <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-1">
          <div className="h-[5px] w-[5px] rounded-full bg-warning" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Needs your review
          </span>
        </div>

        {PLACEHOLDER_PRS.map((pr, index) => (
          <PrItem
            key={pr.number}
            number={pr.number}
            title={pr.title}
            author={pr.author}
            status={pr.status}
            updatedAt={pr.updatedAt}
            isActive={selectedPr === pr.number}
            isFocused={focusIndex === index}
            onClick={() => {
              setFocusIndex(index);
              onSelectPr(pr.number);
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function PrItem({
  number,
  title,
  author,
  status,
  updatedAt,
  isActive,
  isFocused,
  onClick,
}: {
  number: number;
  title: string;
  author: string;
  status: string;
  updatedAt: string;
  isActive: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
        isActive
          ? "border-l-primary bg-accent-muted"
          : isFocused
            ? "border-l-transparent bg-bg-raised"
            : "border-l-transparent hover:bg-bg-raised"
      }`}
    >
      {/* Status dot (§ 8.4 PR items) */}
      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[status] ?? "bg-text-ghost"}`} />

      <div className="min-w-0 flex-1">
        {/* Title: 12px, weight 500, truncate */}
        <p className="truncate text-xs font-medium text-text-primary">{title}</p>
        {/* Meta line: mono 10px, --text-tertiary */}
        <p className="mt-0.5 font-mono text-[10px] text-text-tertiary">
          #{number} · {author} · {updatedAt}
        </p>
      </div>
    </button>
  );
}
