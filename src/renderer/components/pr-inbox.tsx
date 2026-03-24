import type { GhPrEnrichment, GhPrListItemCore } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { MenuItem, MenuPopup, MenuSeparator } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { clamp, relativeTime } from "@/shared/format";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  GitPullRequestClosed,
  Loader2,
  ExternalLink,
  GitMerge,
  Inbox,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useBotSettings } from "../hooks/use-bot-settings";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { ipc } from "../lib/ipc";
import { useKeybindings } from "../lib/keybinding-context";
import { openExternal } from "../lib/open-external";
import { getPrActivityKey, hasNewPrActivity, indexPrActivityStates } from "../lib/pr-activity";
import { summarizePrChecks, type PrCheckSummary } from "../lib/pr-check-status";
import { searchPrs, type SearchablePrItem } from "../lib/pr-search";
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

function resolveStatusDot(
  pr: GhPrListItemCore,
  enrichment: GhPrEnrichment | undefined,
  checkSummary: PrCheckSummary,
): { color: string; pulse: boolean } {
  // Closed → red
  if (pr.state === "CLOSED") {
    return { color: "bg-destructive", pulse: false };
  }
  // Merged → purple
  if (pr.state === "MERGED") {
    return { color: "bg-purple", pulse: false };
  }
  // In merge queue → flashing orange
  if (enrichment?.autoMergeRequest) {
    return { color: "bg-warning", pulse: true };
  }
  // Ready to merge → green (approved + checks passing + no conflicts)
  if (
    !pr.isDraft &&
    pr.reviewDecision === "APPROVED" &&
    checkSummary.state === "passing" &&
    enrichment?.mergeable !== "CONFLICTING"
  ) {
    return { color: "bg-success", pulse: false };
  }
  // Draft → grey
  if (pr.isDraft) {
    return { color: "bg-text-ghost", pulse: false };
  }
  // Default → subtle neutral
  return { color: "bg-text-tertiary", pulse: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrInbox({ selectedPr, onSelectPr }: PrInboxProps) {
  const { cwd } = useWorkspace();
  const { isBot: isBotUser, isBotPr: isBotPrTitle } = useBotSettings();
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("review");
  const searchRef = useRef<HTMLInputElement>(null);

  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "review",
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "mine",
  });

  const allQuery = useQuery({
    queryKey: ["pr", "list", cwd, "all"],
    queryFn: () => ipc("pr.list", { cwd, filter: "all" }),
    refetchInterval: 30_000,
    enabled: activeFilter === "all",
  });

  const activeFilterIpc =
    activeFilter === "mine" ? "authored" : activeFilter === "all" ? "all" : "reviewRequested";

  const enrichmentQuery = useQuery({
    queryKey: ["pr", "enrichment", cwd, activeFilterIpc],
    queryFn: () => ipc("pr.listEnrichment", { cwd, filter: activeFilterIpc }),
    refetchInterval: 30_000,
  });

  // Build enrichment index for O(1) lookups
  const enrichmentIndex = useMemo(() => {
    const map = new Map<string, GhPrEnrichment>();
    for (const e of enrichmentQuery.data ?? []) {
      map.set(String(e.number), e);
    }
    return map;
  }, [enrichmentQuery.data]);

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

  const visiblePrs = useMemo(() => {
    if (activeFilter === "review") {
      return reviewPrs;
    }

    if (activeFilter === "mine") {
      return authorPrs;
    }

    return allPrs;
  }, [activeFilter, allPrs, authorPrs, reviewPrs]);

  const searchablePrs = useMemo<SearchablePrItem[]>(
    () =>
      visiblePrs.map((pr) => ({
        enrichment: enrichmentIndex.get(String(pr.number)),
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(cwd, pr.number)),
        ),
        pr,
      })),
    [cwd, enrichmentIndex, prActivityIndex, visiblePrs],
  );

  const filteredResults = useMemo(
    () => searchPrs(searchablePrs, searchQuery),
    [searchQuery, searchablePrs],
  );

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
        repo: cwd,
        prNumber: pr.number,
        updatedAt: pr.updatedAt,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["pr-activity"] });
        })
        .catch(() => {});

      onSelectPr(pr.number, pr.title);
    },
    [cwd, onSelectPr],
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
    (activeFilter === "mine" && authorQuery.isLoading) ||
    (activeFilter === "all" && allQuery.isLoading) ||
    enrichmentQuery.isLoading;

  return (
    <aside className="border-border bg-bg-surface flex h-full flex-col">
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          Pull Requests
        </h2>
      </div>

      {/* Filter tabs */}
      <div className="border-border flex border-b px-3">
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
            const { enrichment, pr } = item;
            const checkSummary = summarizePrChecks(enrichment?.statusCheckRollup ?? []);

            return (
              <PrItem
                key={pr.number}
                pr={pr}
                enrichment={enrichment}
                cwd={cwd}
                checkSummary={checkSummary}
                statusDot={resolveStatusDot(pr, enrichment, checkSummary)}
                isActive={selectedPr === pr.number}
                isFocused={safeFocusIndex === index}
                hasNewActivity={item.hasNewActivity ?? false}
                isBotPr={isBotUser(pr.author.login) || isBotPrTitle(pr.title)}
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
            active ? "bg-primary/15 text-accent-text" : "bg-bg-raised text-text-tertiary"
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
  enrichment,
  checkSummary,
  statusDot,
  isActive,
  isFocused,
  hasNewActivity,
  isBotPr,
  onClick,
  cwd,
}: {
  pr: GhPrListItemCore;
  enrichment?: GhPrEnrichment;
  checkSummary: PrCheckSummary;
  statusDot: { color: string; pulse: boolean };
  isActive: boolean;
  isFocused: boolean;
  hasNewActivity: boolean;
  isBotPr: boolean;
  onClick: () => void;
  cwd: string;
}) {
  const size = enrichment ? prSizeLabel(enrichment.additions, enrichment.deletions) : null;

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
          cwd={cwd}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-text-primary truncate text-xs font-medium">{pr.title}</p>
            {size && (
              <span
                className={`bg-bg-raised shrink-0 rounded-sm px-1 font-mono text-[9px] font-medium ${size.color}`}
              >
                {size.label}
              </span>
            )}
            <CheckStatusBadge summary={checkSummary} />
            {hasNewActivity && (
              <span className="border-border-accent bg-accent-muted text-accent-text inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.06em] uppercase">
                New
              </span>
            )}
            {isBotPr && (
              <span className="bg-bg-raised text-text-tertiary border-border inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.06em] uppercase">
                <Bot size={9} />
                Bot
              </span>
            )}
          </div>
          <div className="text-text-tertiary mt-0.5 flex items-center gap-1 font-mono text-[10px]">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDot.color} ${statusDot.pulse ? "animate-pulse" : ""}`}
            />
            <span>#{pr.number}</span>
            <span className="text-text-ghost">·</span>
            <span className="truncate">{pr.author.login}</span>
            <span className="text-text-ghost">·</span>
            <span className="shrink-0">{relativeTime(new Date(pr.updatedAt))}</span>
            {!pr.isDraft &&
              pr.reviewDecision === "APPROVED" &&
              checkSummary.state === "passing" &&
              enrichment?.mergeable !== "CONFLICTING" && (
                <>
                  <span className="text-text-ghost">·</span>
                  <span className="text-success flex items-center gap-0.5">
                    <CheckCircle2 size={10} />
                    Ready
                  </span>
                </>
              )}
            {pr.isDraft && (
              <>
                <span className="text-text-ghost">·</span>
                <span className="text-warning">Draft</span>
              </>
            )}
            {enrichment?.mergeable === "CONFLICTING" && (
              <>
                <span className="text-text-ghost">·</span>
                <span className="text-destructive flex items-center gap-0.5">
                  <GitPullRequestClosed size={10} />
                  Conflicts
                </span>
              </>
            )}
            {enrichment?.autoMergeRequest && (
              <>
                <span className="text-text-ghost">·</span>
                <span className="text-info flex items-center gap-0.5">
                  <GitMerge size={10} />
                  Auto
                </span>
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

function CheckStatusBadge({ summary }: { summary: PrCheckSummary }) {
  if (summary.state === "failing") {
    return (
      <span
        title={checkSummaryTitle(summary)}
        className="bg-danger-muted text-destructive inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-medium"
      >
        <XCircle size={11} />
        {summary.failed === 1 ? "1 failed" : `${summary.failed} failed`}
      </span>
    );
  }

  if (summary.state === "pending") {
    return (
      <span
        title={checkSummaryTitle(summary)}
        className="bg-warning-muted text-warning inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-medium"
      >
        <Loader2
          size={11}
          className="animate-spin"
        />
        {summary.pending === 1 ? "1 pending" : `${summary.pending} pending`}
      </span>
    );
  }

  return null;
}

function checkSummaryTitle(summary: PrCheckSummary): string {
  const parts: string[] = [];

  if (summary.failed > 0) {
    parts.push(summary.failed === 1 ? "1 failed check" : `${summary.failed} failed checks`);
  }
  if (summary.pending > 0) {
    parts.push(summary.pending === 1 ? "1 pending check" : `${summary.pending} pending checks`);
  }
  if (summary.passed > 0) {
    parts.push(summary.passed === 1 ? "1 passing check" : `${summary.passed} passing checks`);
  }
  if (summary.neutral > 0) {
    parts.push(
      summary.neutral === 1 ? "1 non-blocking check" : `${summary.neutral} non-blocking checks`,
    );
  }

  return parts.join(", ");
}
