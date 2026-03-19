import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { clamp, relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";

/**
 * PR Inbox sidebar — DISPATCH-DESIGN-SYSTEM.md § 8.4
 *
 * - Width: 260px, bg: --bg-surface, border-right: 1px solid --border
 * - Two sections: "Needs your review" + "Your pull requests"
 * - Keyboard-navigable (j/k/Enter)
 * - Real IPC data with 30s polling
 */

interface PrInboxProps {
  selectedPr: number | null;
  onSelectPr: (pr: number) => void;
}

// ---------------------------------------------------------------------------
// Status dot color mapping
// ---------------------------------------------------------------------------

function resolveStatusColor(
  reviewDecision: string,
  checks: Array<{ conclusion: string | null }>,
  isDraft: boolean,
): string {
  const allPassing = checks.length > 0 && checks.every((c) => c.conclusion === "success");
  const anyFailing = checks.some((c) => c.conclusion === "failure" || c.conclusion === "error");

  if (reviewDecision === "APPROVED" && allPassing) {
    return "bg-success";
  }
  if (anyFailing) {
    return "bg-destructive";
  }
  if (isDraft || checks.some((c) => !c.conclusion)) {
    return "bg-warning";
  }
  if (reviewDecision === "REVIEW_REQUIRED") {
    return "bg-purple";
  }
  return "bg-text-ghost";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrInbox({ selectedPr, onSelectPr }: PrInboxProps) {
  const { cwd } = useWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Real data queries with 30s polling
  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
  });

  const reviewPrs = reviewQuery.data ?? [];
  const authorPrs = authorQuery.data ?? [];

  // Client-side search filter (debounced via useMemo)
  const filteredReview = useMemo(() => {
    if (!searchQuery) {
      return reviewPrs;
    }
    const q = searchQuery.toLowerCase();
    return reviewPrs.filter(
      (pr) => pr.title.toLowerCase().includes(q) || String(pr.number).includes(q),
    );
  }, [reviewPrs, searchQuery]);

  const filteredAuthor = useMemo(() => {
    if (!searchQuery) {
      return authorPrs;
    }
    const q = searchQuery.toLowerCase();
    return authorPrs.filter(
      (pr) => pr.title.toLowerCase().includes(q) || String(pr.number).includes(q),
    );
  }, [authorPrs, searchQuery]);

  const allPrs = useMemo(
    () => [...filteredReview, ...filteredAuthor],
    [filteredReview, filteredAuthor],
  );

  // Keyboard navigation — ignore when typing in inputs
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (event.key === "j") {
        setFocusIndex((i) => Math.min(i + 1, allPrs.length - 1));
      } else if (event.key === "k") {
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        const pr = allPrs[focusIndex];
        if (pr) {
          onSelectPr(pr.number);
        }
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    },
    [focusIndex, onSelectPr, allPrs],
  );

  // Clamp focusIndex when the list shrinks (e.g., PRs removed via polling)
  useEffect(() => {
    if (allPrs.length > 0 && focusIndex >= allPrs.length) {
      setFocusIndex(clamp(focusIndex, 0, allPrs.length - 1));
    }
  }, [allPrs.length, focusIndex]);

  useEffect(() => {
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const isLoading = reviewQuery.isLoading || authorQuery.isLoading;

  return (
    <aside className="border-border bg-bg-surface flex h-full w-[260px] shrink-0 flex-col border-r">
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Pull Requests
        </h2>
      </div>

      {/* Search box */}
      <div className="px-3 pb-2">
        <div className="border-border bg-bg-raised flex items-center gap-2 rounded-md border px-2 py-1.5">
          <Search
            size={13}
            className="text-text-tertiary shrink-0"
          />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search PRs..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                (e.target as HTMLElement).blur();
              }
            }}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-text-tertiary hover:text-text-primary cursor-pointer text-[10px]"
            >
              esc
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-primary h-4 w-4" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allPrs.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
          <Inbox
            size={24}
            className="text-text-ghost"
          />
          <p className="text-text-tertiary text-center text-xs">
            {searchQuery ? "No PRs match your search" : "No pull requests found"}
          </p>
        </div>
      )}

      {/* PR list */}
      {!isLoading && allPrs.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {/* Section: Needs your review */}
          {filteredReview.length > 0 && (
            <>
              <SectionLabel
                label="Needs your review"
                dotColor="bg-purple"
              />
              {filteredReview.map((pr, index) => (
                <PrItem
                  key={pr.number}
                  number={pr.number}
                  title={pr.title}
                  author={pr.author.login}
                  statusColor={resolveStatusColor(
                    pr.reviewDecision,
                    pr.statusCheckRollup,
                    pr.isDraft,
                  )}
                  updatedAt={relativeTime(new Date(pr.updatedAt))}
                  additions={pr.additions}
                  deletions={pr.deletions}
                  isActive={selectedPr === pr.number}
                  isFocused={focusIndex === index}
                  onClick={() => {
                    setFocusIndex(index);
                    onSelectPr(pr.number);
                  }}
                />
              ))}
            </>
          )}

          {/* Section: Your pull requests */}
          {filteredAuthor.length > 0 && (
            <>
              <SectionLabel
                label="Your pull requests"
                dotColor="bg-primary"
              />
              {filteredAuthor.map((pr, authorIndex) => {
                const globalIndex = filteredReview.length + authorIndex;
                return (
                  <PrItem
                    key={pr.number}
                    number={pr.number}
                    title={pr.title}
                    author={pr.author.login}
                    statusColor={resolveStatusColor(
                      pr.reviewDecision,
                      pr.statusCheckRollup,
                      pr.isDraft,
                    )}
                    updatedAt={relativeTime(new Date(pr.updatedAt))}
                    additions={pr.additions}
                    deletions={pr.deletions}
                    isActive={selectedPr === pr.number}
                    isFocused={focusIndex === globalIndex}
                    onClick={() => {
                      setFocusIndex(globalIndex);
                      onSelectPr(pr.number);
                    }}
                  />
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Error state */}
      {(reviewQuery.isError || authorQuery.isError) && (
        <div className="px-3 py-2">
          <p className="text-destructive text-xs">Failed to load PRs. Check your gh auth.</p>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
      <div className={`h-[5px] w-[5px] rounded-full ${dotColor}`} />
      <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </span>
    </div>
  );
}

function prSizeLabel(additions: number, deletions: number): { label: string; color: string } {
  const total = additions + deletions;
  if (total < 50) {
    return { label: "S", color: "text-success" };
  }
  if (total < 200) {
    return { label: "M", color: "text-warning" };
  }
  if (total < 500) {
    return { label: "L", color: "text-info" };
  }
  return { label: "XL", color: "text-destructive" };
}

function PrItem({
  number,
  title,
  author,
  statusColor,
  updatedAt,
  additions,
  deletions,
  isActive,
  isFocused,
  onClick,
}: {
  number: number;
  title: string;
  author: string;
  statusColor: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  isActive: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  const size = prSizeLabel(additions, deletions);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
        isActive
          ? "border-l-primary bg-accent-muted"
          : isFocused
            ? "bg-bg-raised border-l-transparent"
            : "hover:bg-bg-raised border-l-transparent"
      }`}
    >
      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-text-primary truncate text-xs font-medium">{title}</p>
          <span
            className={`bg-bg-raised shrink-0 rounded-sm px-1 font-mono text-[9px] font-medium ${size.color}`}
          >
            {size.label}
          </span>
        </div>
        <p className="text-text-tertiary mt-0.5 font-mono text-[10px]">
          #{number} · {author} · {updatedAt}
        </p>
      </div>
    </button>
  );
}
