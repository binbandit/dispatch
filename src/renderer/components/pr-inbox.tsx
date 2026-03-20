import type { GhPrListItem } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { MenuItem, MenuPopup, MenuSeparator } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { clamp, relativeTime } from "@/shared/format";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, GitMerge, Inbox, Search, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { getPrActivityKey, hasNewPrActivity, indexPrActivityStates } from "../lib/pr-activity";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";
import { PrInboxSkeleton } from "./loading-skeletons";

/**
 * PR Inbox sidebar — DISPATCH-DESIGN-SYSTEM.md § 8.4
 *
 * Filter tabs: Review | Mine | All
 * Keyboard-navigable (j/k/Enter), search with /
 */

interface PrInboxProps {
  selectedPr: number | null;
  onSelectPr: (pr: number, title?: string) => void;
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
  const { cwd, switchWorkspace } = useWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("review");
  const [multiRepo, setMultiRepo] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Single-repo queries (lazy — only active tab fires)
  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
    enabled: !multiRepo && activeFilter === "review",
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
    enabled: !multiRepo && activeFilter === "mine",
  });

  const allQuery = useQuery({
    queryKey: ["pr", "list", cwd, "all"],
    queryFn: () => ipc("pr.list", { cwd, filter: "all" }),
    refetchInterval: 30_000,
    enabled: !multiRepo && activeFilter === "all",
  });

  // Multi-repo query (when toggle is active)
  const multiRepoQuery = useQuery({
    queryKey: ["pr", "listAll", activeFilter],
    queryFn: () =>
      ipc("pr.listAll", {
        filter:
          activeFilter === "mine" ? "authored" : activeFilter === "all" ? "all" : "reviewRequested",
      }),
    refetchInterval: 30_000,
    enabled: multiRepo,
    placeholderData: (prev) => prev, // Keep previous data while fetching new filter
  });

  const reviewPrs = multiRepo ? [] : (reviewQuery.data ?? []);
  const authorPrs = multiRepo ? [] : (authorQuery.data ?? []);
  const allPrs = multiRepo ? [] : (allQuery.data ?? []);
  const multiRepoPrs = multiRepoQuery.data ?? [];
  const prActivityQuery = useQuery({
    queryKey: ["pr-activity", "list"],
    queryFn: () => ipc("prActivity.list"),
    staleTime: 30_000,
  });
  const prActivityIndex = useMemo(
    () => indexPrActivityStates(prActivityQuery.data ?? []),
    [prActivityQuery.data],
  );

  // Filter by active tab + search
  const filteredPrs = useMemo(() => {
    let prs: GhPrListItem[];
    if (multiRepo) {
      prs = multiRepoPrs;
    } else {
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
  }, [reviewPrs, authorPrs, allPrs, multiRepoPrs, activeFilter, searchQuery, multiRepo]);

  const handleSelectPr = useCallback(
    (pr: GhPrListItem) => {
      const prAny = pr as GhPrListItem & { workspacePath?: string };
      const prCwd = multiRepo ? (prAny.workspacePath ?? cwd) : cwd;

      void ipc("prActivity.markSeen", {
        repo: prCwd,
        prNumber: pr.number,
        updatedAt: pr.updatedAt,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["pr-activity"] });
        })
        .catch(() => {});

      if (multiRepo && prAny.workspacePath && prAny.workspacePath !== cwd) {
        switchWorkspace(prAny.workspacePath);
      }

      onSelectPr(pr.number, pr.title);
    },
    [cwd, multiRepo, onSelectPr, switchWorkspace],
  );

  // Clamp focusIndex when the list shrinks
  useEffect(() => {
    if (filteredPrs.length > 0 && focusIndex >= filteredPrs.length) {
      setFocusIndex(clamp(focusIndex, 0, filteredPrs.length - 1));
    }
  }, [filteredPrs.length, focusIndex]);

  useKeyboardShortcuts([
    {
      key: "j",
      handler: () => setFocusIndex((i) => Math.min(i + 1, filteredPrs.length - 1)),
    },
    {
      key: "k",
      handler: () => setFocusIndex((i) => Math.max(i - 1, 0)),
    },
    {
      key: "Enter",
      handler: () => {
        const pr = filteredPrs[focusIndex];
        if (pr) {
          handleSelectPr(pr);
        }
      },
    },
    {
      key: "/",
      handler: () => searchRef.current?.focus(),
    },
  ]);

  const isLoading = multiRepo
    ? multiRepoQuery.isLoading
    : (activeFilter === "review" && reviewQuery.isLoading) ||
      (activeFilter === "mine" && authorQuery.isLoading) ||
      (activeFilter === "all" && allQuery.isLoading);

  // Tab counts — show multi-repo count when in that mode
  const reviewCount = multiRepo ? multiRepoPrs.length : reviewPrs.length;
  const mineCount = multiRepo ? 0 : authorPrs.length;
  const allCount = multiRepo ? multiRepoPrs.length : allPrs.length;

  return (
    <aside className="border-border bg-bg-surface flex h-full flex-col">
      {/* Header with multi-repo toggle */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Pull Requests
        </h2>
        <button
          type="button"
          onClick={() => {
            setMultiRepo(!multiRepo);
            setFocusIndex(0);
          }}
          className={`cursor-pointer rounded-sm px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
            multiRepo ? "bg-primary/15 text-primary" : "text-text-ghost hover:text-text-tertiary"
          }`}
          title={multiRepo ? "Showing all repos" : "Show all repos"}
        >
          {multiRepo ? "All repos" : "This repo"}
        </button>
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
        <div className="flex-1 overflow-y-auto">
          <PrInboxSkeleton />
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
          {filteredPrs.map((pr, index) => {
            const prAny = pr as GhPrListItem & { workspace?: string; workspacePath?: string };
            const prCwd = multiRepo ? (prAny.workspacePath ?? cwd) : cwd;

            return (
              <PrItem
                key={multiRepo ? `${prCwd}:${pr.number}` : pr.number}
                pr={pr}
                cwd={prCwd}
                statusColor={resolveStatusColor(
                  pr.reviewDecision,
                  pr.statusCheckRollup,
                  pr.isDraft,
                )}
                isActive={selectedPr === pr.number}
                isFocused={focusIndex === index}
                hasNewActivity={hasNewPrActivity(
                  pr.updatedAt,
                  prActivityIndex.get(getPrActivityKey(prCwd, pr.number)),
                )}
                workspace={multiRepo ? prAny.workspace : undefined}
                onClick={() => {
                  setFocusIndex(index);
                  handleSelectPr(pr);
                }}
              />
            );
          })}
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
          className={`ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-medium ${
            active ? "bg-primary/15 text-accent-text" : "bg-bg-raised text-text-ghost"
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
  hasNewActivity,
  onClick,
  workspace,
  cwd,
}: {
  pr: GhPrListItem;
  statusColor: string;
  isActive: boolean;
  isFocused: boolean;
  hasNewActivity: boolean;
  onClick: () => void;
  workspace?: string;
  cwd: string;
}) {
  const size = prSizeLabel(pr.additions, pr.deletions);

  const approveMutation = useMutation({
    mutationFn: () => ipc("pr.submitReview", { cwd, prNumber: pr.number, event: "APPROVE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: `PR #${pr.number} approved`, type: "success" });
    },
    onError: (err) => {
      toastManager.add({
        title: "Approve failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () => ipc("pr.merge", { cwd, prNumber: pr.number, strategy: "squash" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: `PR #${pr.number} merged`,
        description: "Branch deleted.",
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({ title: "Merge failed", description: String(err.message), type: "error" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => ipc("pr.close", { cwd, prNumber: pr.number }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: `PR #${pr.number} closed`, type: "success" });
    },
    onError: (err) => {
      toastManager.add({ title: "Close failed", description: String(err.message), type: "error" });
    },
  });

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
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
          />
        }
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
            {hasNewActivity && (
              <span className="border-border-accent bg-accent-muted text-accent-text inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.06em] uppercase">
                New
              </span>
            )}
          </div>
          <div className="text-text-tertiary mt-0.5 flex items-center gap-1 font-mono text-[10px]">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
            <span>#{pr.number}</span>
            <span className="text-text-ghost">·</span>
            <span className="truncate">{pr.author.login}</span>
            {workspace && (
              <>
                <span className="text-text-ghost">·</span>
                <span className="text-info truncate">{workspace}</span>
              </>
            )}
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
      </ContextMenu.Trigger>
      <MenuPopup
        side="bottom"
        align="start"
        className="border-border bg-bg-elevated w-48 rounded-md border shadow-lg"
      >
        <MenuItem
          className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs"
          onClick={() => approveMutation.mutate()}
        >
          <Check
            size={13}
            className="text-success"
          />
          Approve
        </MenuItem>
        <MenuItem
          className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs"
          onClick={() => mergeMutation.mutate()}
        >
          <GitMerge
            size={13}
            className="text-primary"
          />
          Squash & Merge
        </MenuItem>
        <MenuItem
          className="text-destructive hover:bg-destructive/10 flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs"
          onClick={() => closeMutation.mutate()}
        >
          <XCircle size={13} />
          Close
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs"
          onClick={() => {
            void openExternal(pr.url);
          }}
        >
          <ExternalLink size={13} />
          Open in Browser
        </MenuItem>
        <MenuItem
          className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs"
          onClick={() => {
            navigator.clipboard.writeText(pr.url);
            toastManager.add({ title: "URL copied", type: "success" });
          }}
        >
          <Copy size={13} />
          Copy URL
        </MenuItem>
      </MenuPopup>
    </ContextMenu.Root>
  );
}
