/* eslint-disable import/max-dependencies -- The inbox owns search, filtering, actions, and activity state for the PR list sidebar. */
import type { GhPrListItemCore, IpcApi, RepoTarget } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { MenuItem, MenuPopup, MenuSeparator } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { PrInboxSkeleton } from "@/renderer/components/shared/loading-skeletons";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import {
  type PrSearchRefreshRequest,
  usePrSearchRefreshOnMiss,
} from "@/renderer/hooks/app/use-pr-search-refresh";
import {
  formatAuthorName,
  useDisplayNameFormat,
} from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { searchPrs, type SearchablePrItem } from "@/renderer/lib/inbox/pr-search";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  getPrActivityKey,
  hasNewPrActivity,
  indexPrActivityStates,
} from "@/renderer/lib/review/pr-activity";
import { clamp, relativeTime } from "@/shared/format";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, GitMerge, Inbox, Search, X, XCircle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

/**
 * PR Inbox sidebar — DISPATCH-DESIGN-SYSTEM.md § 8.4
 *
 * Filter tabs: Review | Re-review | Mine | All
 * Keyboard-navigable (j/k/Enter), search with /
 */

interface PrInboxProps {
  selectedPr: number | null;
  onSelectPr: (pr: number, title?: string) => void;
}

type FilterTab = "review" | "reReview" | "mine" | "all";

// ---------------------------------------------------------------------------
// Status indicator — icon-based state representation
// ---------------------------------------------------------------------------

interface StatusIndicator {
  dotColor: string;
  pulse: boolean;
  label: string;
}

function resolveStatusIndicator(pr: GhPrListItemCore): StatusIndicator {
  // Closed → red
  if (pr.state === "CLOSED") {
    return { dotColor: "bg-destructive", pulse: false, label: "Closed" };
  }
  // Merged → purple
  if (pr.state === "MERGED") {
    return { dotColor: "bg-purple", pulse: false, label: "Merged" };
  }
  // Changes requested → orange
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { dotColor: "bg-warning", pulse: false, label: "Changes requested" };
  }
  // Approved → green
  if (!pr.isDraft && pr.reviewDecision === "APPROVED") {
    return { dotColor: "bg-success", pulse: false, label: "Approved" };
  }
  // Draft → ghost
  if (pr.isDraft) {
    return { dotColor: "bg-text-ghost", pulse: false, label: "Draft" };
  }
  // Default → open, needs review (purple for review requested)
  return { dotColor: "bg-purple", pulse: false, label: "Review requested" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrInbox({ selectedPr, onSelectPr }: PrInboxProps) {
  const { nwo, repoTarget } = useWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("review");
  const searchRef = useRef<HTMLInputElement>(null);

  const reviewQuery = useQuery({
    queryKey: ["pr", "list", nwo, "reviewRequested", "open"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "reviewRequested" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "review",
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", nwo, "authored", "open"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "authored" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "mine",
  });

  const allQuery = useQuery({
    queryKey: ["pr", "list", nwo, "all", "all"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "all", state: "all" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "all",
  });

  const activeFilterIpc: IpcApi["pr.list"]["args"]["filter"] =
    activeFilter === "mine" ? "authored" : activeFilter === "all" ? "all" : "reviewRequested";
  const activeState: IpcApi["pr.list"]["args"]["state"] = activeFilter === "all" ? "all" : "open";

  const reviewPrs = reviewQuery.data ?? [];
  const authorPrs = authorQuery.data ?? [];
  const allPrs = allQuery.data ?? [];
  const prActivityQuery = useQuery({
    queryKey: ["pr-activity", "list"],
    queryFn: () => ipc("prActivity.list"),
    staleTime: 30_000,
  });
  const prActivityIndex = useMemo(
    () => indexPrActivityStates(prActivityQuery.data ?? []),
    [prActivityQuery.data],
  );

  const reviewPrsWithActivity = useMemo<SearchablePrItem[]>(
    () =>
      reviewPrs.map((pr) => ({
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(nwo, pr.number)),
        ),
        pr,
      })),
    [nwo, prActivityIndex, reviewPrs],
  );

  const reReviewPrsWithActivity = useMemo(
    () => reviewPrsWithActivity.filter((item) => item.hasNewActivity),
    [reviewPrsWithActivity],
  );

  const authorPrsWithActivity = useMemo<SearchablePrItem[]>(
    () =>
      authorPrs.map((pr) => ({
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(nwo, pr.number)),
        ),
        pr,
      })),
    [nwo, prActivityIndex, authorPrs],
  );

  const allPrsWithActivity = useMemo<SearchablePrItem[]>(
    () =>
      allPrs.map((pr) => ({
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(nwo, pr.number)),
        ),
        pr,
      })),
    [nwo, allPrs, prActivityIndex],
  );

  const visiblePrs = useMemo(() => {
    if (activeFilter === "review") {
      return reviewPrsWithActivity;
    }

    if (activeFilter === "reReview") {
      return reReviewPrsWithActivity;
    }

    if (activeFilter === "mine") {
      return authorPrsWithActivity;
    }

    return allPrsWithActivity;
  }, [
    activeFilter,
    allPrsWithActivity,
    authorPrsWithActivity,
    reReviewPrsWithActivity,
    reviewPrsWithActivity,
  ]);

  const filteredResults = useMemo(
    () => searchPrs(visiblePrs, searchQuery),
    [searchQuery, visiblePrs],
  );
  const searchRefreshRequests = useMemo<PrSearchRefreshRequest[]>(
    () => [
      {
        method: "pr.list",
        args: { ...repoTarget, filter: activeFilterIpc, state: activeState },
        queryKey: ["pr", "list", nwo, activeFilterIpc, activeState],
      },
    ],
    [activeFilterIpc, activeState, nwo, repoTarget],
  );

  usePrSearchRefreshOnMiss({
    scope: `pr-inbox:${nwo}:${activeFilterIpc}`,
    searchQuery,
    resultCount: filteredResults.length,
    requests: searchRefreshRequests,
  });

  const focusSearchInput = useCallback(() => {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      searchRef.current?.focus();
      return;
    }

    globalThis.requestAnimationFrame(() => {
      const input = searchRef.current;
      if (!input) {
        return;
      }

      input.focus();
      const cursorPosition = input.value.length;
      input.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, []);

  const updateSearchQuery = useCallback((nextQuery: string) => {
    setSearchQuery(nextQuery);
    setFocusIndex(0);
  }, []);

  const handleSelectPr = useCallback(
    (pr: GhPrListItemCore) => {
      void ipc("prActivity.markSeen", {
        repo: nwo,
        prNumber: pr.number,
        updatedAt: pr.updatedAt,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["pr-activity"] });
        })
        .catch(() => {});

      onSelectPr(pr.number, pr.title);
    },
    [nwo, onSelectPr],
  );

  // Derive a safe focus index — stays valid when the list shrinks without
  // Needing an effect to sync state after render.
  const safeFocusIndex =
    filteredResults.length > 0 ? clamp(focusIndex, 0, filteredResults.length - 1) : 0;

  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    {
      ...getBinding("navigation.prevPr"),
      handler: () => setFocusIndex((i) => Math.min(i + 1, filteredResults.length - 1)),
    },
    {
      ...getBinding("navigation.nextPr"),
      handler: () => setFocusIndex((i) => Math.max(i - 1, 0)),
    },
    {
      ...getBinding("navigation.openPr"),
      handler: () => {
        const match = filteredResults[safeFocusIndex];
        if (match) {
          handleSelectPr(match.item.pr);
        }
      },
    },
    {
      ...getBinding("search.focusSearch"),
      handler: () => searchRef.current?.focus(),
    },
  ]);

  const hasSearch = searchQuery.trim().length > 0;

  const isLoading =
    (activeFilter === "review" && reviewQuery.isLoading) ||
    (activeFilter === "reReview" && reviewQuery.isLoading) ||
    (activeFilter === "mine" && authorQuery.isLoading) ||
    (activeFilter === "all" && allQuery.isLoading);

  return (
    <aside className="border-border bg-bg-surface flex h-full flex-col">
      <div className="px-3 pt-2.5 pb-2">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Pull Requests</h2>
      </div>

      {/* Filter toggle group */}
      <div className="px-3 pb-2">
        <div className="bg-bg-raised flex gap-0.5 rounded-md p-0.5">
          <FilterButton
            label="Review"
            count={reviewPrs.length}
            active={activeFilter === "review"}
            onClick={() => {
              setActiveFilter("review");
              setFocusIndex(0);
            }}
          />
          <FilterButton
            label="Re-review"
            count={reReviewPrsWithActivity.length}
            active={activeFilter === "reReview"}
            onClick={() => {
              setActiveFilter("reReview");
              setFocusIndex(0);
            }}
          />
          <FilterButton
            label="Mine"
            count={authorPrs.length}
            active={activeFilter === "mine"}
            onClick={() => {
              setActiveFilter("mine");
              setFocusIndex(0);
            }}
          />
          <FilterButton
            label="All"
            count={allPrs.length}
            active={activeFilter === "all"}
            onClick={() => {
              setActiveFilter("all");
              setFocusIndex(0);
            }}
          />
        </div>
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
            onChange={(e) => updateSearchQuery(e.target.value)}
            placeholder="Search title, #123, @author, branch..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            title="Search title, #123, @author, branch, repo, or use status:, is:, size:, and base:"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const match = filteredResults[safeFocusIndex];
                if (match) {
                  event.preventDefault();
                  handleSelectPr(match.item.pr);
                }
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                if (searchQuery) {
                  updateSearchQuery("");
                  return;
                }

                (event.target as HTMLElement).blur();
              }
            }}
          />
              {hasSearch ? (
            <button
              type="button"
              onClick={() => {
                updateSearchQuery("");
                focusSearchInput();
              }}
              className="text-text-tertiary hover:text-text-primary flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm transition-colors"
              aria-label="Clear pull request search"
            >
              <X size={12} />
            </button>
          ) : (
            <Kbd className="h-4 min-w-4 px-1 font-mono text-[10px]">/</Kbd>
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
      {!isLoading && filteredResults.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          {hasSearch ? (
            <>
              <Search
                size={20}
                className="text-text-ghost"
              />
              <p className="text-text-tertiary text-center text-xs">No PRs match your search.</p>
            </>
          ) : (
            <>
              <Inbox
                size={24}
                className="text-text-ghost"
              />
              <p className="text-text-tertiary text-center text-xs">
                {activeFilter === "review"
                  ? "No PRs need your review"
                  : activeFilter === "reReview"
                    ? "No PRs need re-review"
                    : activeFilter === "mine"
                      ? "You have no open PRs"
                      : "No pull requests found"}
              </p>
            </>
          )}
        </div>
      )}

      {/* PR list */}
      {!isLoading && filteredResults.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {filteredResults.map(({ item }, index) => {
            const { pr } = item;

            return (
              <PrItem
                key={pr.number}
                pr={pr}
                repoTarget={repoTarget}
                statusIndicator={resolveStatusIndicator(pr)}
                isActive={selectedPr === pr.number}
                isFocused={safeFocusIndex === index}
                hasNewActivity={item.hasNewActivity ?? false}
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
      className={`flex cursor-pointer items-center gap-1 rounded-sm px-2.5 py-[3px] text-[11px] font-medium transition-colors select-none ${
        active
          ? "bg-bg-elevated text-text-primary shadow-sm"
          : "text-text-tertiary hover:text-text-primary"
      }`}
    >
      {label}
      {count > 0 && <span className="text-accent-text font-mono text-[9px]">{count}</span>}
    </button>
  );
}

function prSizeLabel(additions: number, deletions: number): { label: string; bgColor: string } {
  const total = additions + deletions;
  if (total < 50) {
    return { label: "S", bgColor: "bg-success-muted text-success" };
  }
  if (total < 200) {
    return { label: "M", bgColor: "bg-warning-muted text-warning" };
  }
  if (total < 500) {
    return { label: "L", bgColor: "bg-[rgba(232,166,85,0.12)] text-accent-text" };
  }
  return { label: "XL", bgColor: "bg-danger-muted text-destructive" };
}

function PrItem({
  pr,
  statusIndicator,
  isActive,
  isFocused,
  hasNewActivity,
  onClick,
  repoTarget,
}: {
  pr: GhPrListItemCore;
  statusIndicator: StatusIndicator;
  isActive: boolean;
  isFocused: boolean;
  hasNewActivity: boolean;
  onClick: () => void;
  repoTarget: RepoTarget;
}) {
  const nameFormat = useDisplayNameFormat();
  const size = prSizeLabel(pr.additions, pr.deletions);

  const approveMutation = useMutation({
    mutationFn: () =>
      ipc("pr.submitReview", { ...repoTarget, prNumber: pr.number, event: "APPROVE" }),
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
    mutationFn: () => ipc("pr.merge", { ...repoTarget, prNumber: pr.number, strategy: "squash" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      if (result.queued) {
        toastManager.add({
          title: `PR #${pr.number} added to merge queue`,
          type: "success",
        });
      } else {
        toastManager.add({
          title: `PR #${pr.number} merged`,
          description: "Branch deleted.",
          type: "success",
        });
      }
    },
    onError: (err) => {
      toastManager.add({ title: "Merge failed", description: String(err.message), type: "error" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => ipc("pr.close", { ...repoTarget, prNumber: pr.number }),
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
            className={`flex w-full cursor-pointer items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
              isActive
                ? "border-l-primary bg-accent-muted"
                : isFocused
                  ? "bg-bg-raised border-l-transparent"
                  : "hover:bg-bg-raised border-l-transparent"
            }`}
          />
        }
      >
        {/* Status dot */}
        <div
          className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${statusIndicator.dotColor} ${statusIndicator.pulse ? "animate-pulse" : ""}`}
          title={statusIndicator.label}
        />
        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="text-text-primary truncate text-xs font-medium">{pr.title}</div>
          <div className="text-text-tertiary mt-0.5 flex items-center gap-1 font-mono text-[10px]">
            <span>#{pr.number}</span>
            <span className="text-text-ghost">&middot;</span>
            <span className="truncate">{formatAuthorName(pr.author, nameFormat)}</span>
          </div>
        </div>
        {/* Right column — time + size badge */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-text-ghost font-mono text-[10px]">
            {relativeTime(new Date(pr.updatedAt))}
          </span>
          {size && (
            <span className={`rounded-xs px-1 font-mono text-[9px] font-semibold ${size.bgColor}`}>
              {size.label}
            </span>
          )}
          {hasNewActivity && !isActive && <span className="bg-primary h-1.5 w-1.5 rounded-full" />}
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
