import type { GhPrListItem } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { clamp, relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";

/**
 * PR Inbox sidebar — DISPATCH-DESIGN-SYSTEM.md § 8.4
 *
 * Filter tabs: Review | Mine | All
 * Keyboard-navigable (j/k/Enter), search with /
 */

interface PrInboxProps {
  selectedPr: number | null;
  onSelectPr: (pr: number) => void;
}

type FilterTab = "review" | "mine" | "all";

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
  const [activeFilter, setActiveFilter] = useState<FilterTab>("review");
  const searchRef = useRef<HTMLInputElement>(null);

  // Data queries with 30s polling — each tab has its own query
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

  const allQuery = useQuery({
    queryKey: ["pr", "list", cwd, "all"],
    queryFn: () => ipc("pr.list", { cwd, filter: "all" }),
    refetchInterval: 30_000,
  });

  const reviewPrs = reviewQuery.data ?? [];
  const authorPrs = authorQuery.data ?? [];
  const allPrs = allQuery.data ?? [];

  // Filter by active tab + search
  const filteredPrs = useMemo(() => {
    let prs: GhPrListItem[];
    switch (activeFilter) {
      case "review": {
        prs = reviewPrs;
        break;
      }
      case "mine": {
        prs = authorPrs;
        break;
      }
      case "all": {
        prs = allPrs;
        break;
      }
    }

    if (!searchQuery) {
      return prs;
    }
    const q = searchQuery.toLowerCase();
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        pr.author.login.toLowerCase().includes(q),
    );
  }, [reviewPrs, authorPrs, allPrs, activeFilter, searchQuery]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (event.key === "j") {
        setFocusIndex((i) => Math.min(i + 1, filteredPrs.length - 1));
      } else if (event.key === "k") {
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        const pr = filteredPrs[focusIndex];
        if (pr) {
          onSelectPr(pr.number);
        }
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    },
    [focusIndex, onSelectPr, filteredPrs],
  );

  // Clamp focusIndex when the list shrinks
  useEffect(() => {
    if (filteredPrs.length > 0 && focusIndex >= filteredPrs.length) {
      setFocusIndex(clamp(focusIndex, 0, filteredPrs.length - 1));
    }
  }, [filteredPrs.length, focusIndex]);

  useEffect(() => {
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const isLoading =
    (activeFilter === "review" && reviewQuery.isLoading) ||
    (activeFilter === "mine" && authorQuery.isLoading) ||
    (activeFilter === "all" && allQuery.isLoading);

  // Tab counts
  const reviewCount = reviewPrs.length;
  const mineCount = authorPrs.length;
  const allCount = allPrs.length;

  return (
    <aside className="border-border bg-bg-surface flex h-full flex-col">
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Pull Requests
        </h2>
      </div>

      {/* Filter tabs */}
      <div className="border-border flex border-b px-3">
        <FilterButton
          label="Review"
          count={reviewCount}
          active={activeFilter === "review"}
          onClick={() => {
            setActiveFilter("review");
            setFocusIndex(0);
          }}
        />
        <FilterButton
          label="Mine"
          count={mineCount}
          active={activeFilter === "mine"}
          onClick={() => {
            setActiveFilter("mine");
            setFocusIndex(0);
          }}
        />
        <FilterButton
          label="All"
          count={allCount}
          active={activeFilter === "all"}
          onClick={() => {
            setActiveFilter("all");
            setFocusIndex(0);
          }}
        />
      </div>

      {/* Search box */}
      <div className="px-3 py-2">
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
      {!isLoading && filteredPrs.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
          <Inbox
            size={24}
            className="text-text-ghost"
          />
          <p className="text-text-tertiary text-center text-xs">
            {searchQuery
              ? "No PRs match your search"
              : activeFilter === "review"
                ? "No PRs need your review"
                : activeFilter === "mine"
                  ? "You have no open PRs"
                  : "No pull requests found"}
          </p>
        </div>
      )}

      {/* PR list */}
      {!isLoading && filteredPrs.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {filteredPrs.map((pr, index) => (
            <PrItem
              key={pr.number}
              pr={pr}
              statusColor={resolveStatusColor(pr.reviewDecision, pr.statusCheckRollup, pr.isDraft)}
              isActive={selectedPr === pr.number}
              isFocused={focusIndex === index}
              onClick={() => {
                setFocusIndex(index);
                onSelectPr(pr.number);
              }}
            />
          ))}
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

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative cursor-pointer px-2.5 pt-1 pb-2 text-[11px] transition-colors ${
        active ? "text-text-primary font-medium" : "text-text-tertiary hover:text-text-secondary"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-1 font-mono text-[10px] ${
            active ? "text-accent-text" : "text-text-ghost"
          }`}
        >
          {count}
        </span>
      )}
      {active && (
        <div className="bg-primary absolute bottom-0 left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px]" />
      )}
    </button>
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
  pr,
  statusColor,
  isActive,
  isFocused,
  onClick,
}: {
  pr: GhPrListItem;
  statusColor: string;
  isActive: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  const size = prSizeLabel(pr.additions, pr.deletions);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-start gap-2.5 border-l-2 px-3 py-2 text-left transition-colors ${
        isActive
          ? "border-l-primary bg-accent-muted"
          : isFocused
            ? "bg-bg-raised border-l-transparent"
            : "hover:bg-bg-raised border-l-transparent"
      }`}
    >
      {/* Author avatar */}
      <GitHubAvatar
        login={pr.author.login}
        size={20}
        className="border-border mt-0.5 border"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-text-primary truncate text-xs font-medium">{pr.title}</p>
          <span
            className={`bg-bg-raised shrink-0 rounded-sm px-1 font-mono text-[9px] font-medium ${size.color}`}
          >
            {size.label}
          </span>
        </div>
        <div className="text-text-tertiary mt-0.5 flex items-center gap-1 font-mono text-[10px]">
          <span className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${statusColor}`} />
          <span>#{pr.number}</span>
          <span className="text-text-ghost">·</span>
          <span className="truncate">{pr.author.login}</span>
          <span className="text-text-ghost">·</span>
          <span className="shrink-0">{relativeTime(new Date(pr.updatedAt))}</span>
          {pr.isDraft && (
            <>
              <span className="text-text-ghost">·</span>
              <span className="text-warning">Draft</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
