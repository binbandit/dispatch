/* eslint-disable import/max-dependencies -- The home view intentionally centralizes dashboard data and section rendering for the main workspace surface. */
import type { GhPrEnrichment } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { usePrSearchRefreshOnMiss } from "@/renderer/hooks/app/use-pr-search-refresh";
import { useDisplayNameFormat } from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  categorizeHomePrs,
  getDashboardPrKey,
  type DashboardPr,
  type EnrichedDashboardPr,
  type SectionId,
} from "@/renderer/lib/inbox/home-prs";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  getPrActivityKey,
  hasNewPrActivity,
  indexPrActivityStates,
} from "@/renderer/lib/review/pr-activity";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { KbdHint, PrSectionView, RepoSelector } from "./home-view-parts";

// ---------------------------------------------------------------------------
// HomeView
// ---------------------------------------------------------------------------

export function HomeView() {
  const { cwd, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();
  const nameFormat = useDisplayNameFormat();
  const repoName = cwd.split("/").pop() ?? "";

  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionId>>(
    new Set(["completed"]),
  );
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const repoRef = useRef<HTMLDivElement>(null);

  // Current user
  const userQuery = useQuery({
    queryKey: ["env", "user"],
    queryFn: () => ipc("env.user"),
    staleTime: 300_000,
  });
  const currentUser = userQuery.data?.login ?? null;

  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", cwd],
    queryFn: () => ipc("repo.info", { cwd }),
    staleTime: 60_000,
  });

  // All PRs for the selected repository, including merged/closed.
  const allQuery = useQuery({
    queryKey: ["pr", "list", cwd, "all", "all"],
    queryFn: () => ipc("pr.list", { cwd, filter: "all", state: "all" }),
    refetchInterval: 30_000,
  });

  // Review-requested PRs for the selected repository.
  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested", "open"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });

  // Enrichment for open PRs only. Closed and merged PRs do not need live CI state.
  const allEnrichmentQuery = useQuery({
    queryKey: ["pr", "enrichment", cwd, "all", "open"],
    queryFn: () => ipc("pr.listEnrichment", { cwd, filter: "all", state: "open" }),
    refetchInterval: 30_000,
  });

  const workspaceCountsQuery = useQuery({
    queryKey: ["pr", "listAll", "all", "all"],
    queryFn: () => ipc("pr.listAll", { filter: "all", state: "all" }),
    refetchInterval: 30_000,
  });

  // PR activity (for new-activity dots)
  const prActivityQuery = useQuery({
    queryKey: ["pr-activity", "list"],
    queryFn: () => ipc("prActivity.list"),
    staleTime: 30_000,
  });
  const prActivityIndex = useMemo(
    () => indexPrActivityStates(prActivityQuery.data ?? []),
    [prActivityQuery.data],
  );

  // Workspaces for repo selector
  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });

  // Build enrichment indexes
  const repoIdentity = repoInfoQuery.data?.nameWithOwner ?? repoName;
  const pullRequestRepository = repoInfoQuery.data?.parent ?? repoIdentity;
  const isForkWorkspace = repoInfoQuery.data?.isFork ?? false;

  const allEnrichmentIndex = useMemo(() => {
    const map = new Map<string, GhPrEnrichment>();
    for (const e of allEnrichmentQuery.data ?? []) {
      map.set(getDashboardPrKey(pullRequestRepository, e.number), e);
    }
    return map;
  }, [allEnrichmentQuery.data, pullRequestRepository]);

  // Enrich PR lists
  const enrichPr = useCallback(
    (pr: DashboardPr, enrichmentIndex: Map<string, GhPrEnrichment>): EnrichedDashboardPr => {
      const enrichmentData = enrichmentIndex.get(
        getDashboardPrKey(pr.pullRequestRepository, pr.number),
      );
      const enrichment = enrichmentData
        ? {
            ...enrichmentData,
            workspacePath: pr.workspacePath,
            repository: pr.repository,
            pullRequestRepository: pr.pullRequestRepository,
            isForkWorkspace: pr.isForkWorkspace,
          }
        : undefined;
      return {
        pr,
        enrichment,
        checkSummary: summarizePrChecks(enrichmentData?.statusCheckRollup ?? []),
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(pr.workspacePath, pr.number)),
        ),
      };
    },
    [prActivityIndex],
  );

  const allPrs = useMemo(
    () =>
      (allQuery.data ?? []).map((pr) =>
        enrichPr(
          {
            ...pr,
            workspace: repoName,
            workspacePath: cwd,
            repository: repoIdentity,
            pullRequestRepository,
            isForkWorkspace,
          },
          allEnrichmentIndex,
        ),
      ),
    [
      allEnrichmentIndex,
      allQuery.data,
      cwd,
      enrichPr,
      isForkWorkspace,
      pullRequestRepository,
      repoIdentity,
      repoName,
    ],
  );

  const reviewRequestedKeys = useMemo(
    () =>
      new Set(
        (reviewQuery.data ?? []).map((pr) => getDashboardPrKey(pullRequestRepository, pr.number)),
      ),
    [pullRequestRepository, reviewQuery.data],
  );

  // Categorize into sections
  const sections = useMemo(
    () => categorizeHomePrs(allPrs, reviewRequestedKeys, currentUser),
    [allPrs, currentUser, reviewRequestedKeys],
  );

  // Search filter
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) {
      return sections.filter((sec) => sec.items.length > 0);
    }
    const q = searchQuery.toLowerCase();
    return sections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter(
          ({ pr }) =>
            pr.title.toLowerCase().includes(q) ||
            `#${pr.number}`.includes(q) ||
            pr.author.login.toLowerCase().includes(q) ||
            (pr.author.name?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [sections, searchQuery]);
  const filteredCount = useMemo(
    () => filteredSections.reduce((sum, section) => sum + section.items.length, 0),
    [filteredSections],
  );
  const searchRefreshRequests = useMemo(
    () => [
      {
        method: "pr.list" as const,
        args: { cwd, filter: "all" as const, state: "all" as const },
        queryKey: ["pr", "list", cwd, "all", "all"],
      },
      {
        method: "pr.list" as const,
        args: { cwd, filter: "reviewRequested" as const },
        queryKey: ["pr", "list", cwd, "reviewRequested", "open"],
      },
      {
        method: "pr.listEnrichment" as const,
        args: { cwd, filter: "all" as const, state: "open" as const },
        queryKey: ["pr", "enrichment", cwd, "all", "open"],
      },
    ],
    [cwd],
  );

  usePrSearchRefreshOnMiss({
    scope: `home:${cwd}`,
    searchQuery,
    resultCount: filteredCount,
    requests: searchRefreshRequests,
  });

  // Flat list of all visible PRs for keyboard nav
  const flatPrs = useMemo(
    () => filteredSections.flatMap((sec) => (collapsedSections.has(sec.id) ? [] : sec.items)),
    [filteredSections, collapsedSections],
  );

  // Attention count for hero
  const attentionCount = useMemo(
    () => sections.find((s) => s.id === "attention")?.items.length ?? 0,
    [sections],
  );

  const totalCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.items.length, 0),
    [sections],
  );

  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const pr of workspaceCountsQuery.data ?? []) {
      counts.set(pr.workspacePath, (counts.get(pr.workspacePath) ?? 0) + 1);
    }

    return counts;
  }, [workspaceCountsQuery.data]);

  const activeWorkspaceCount = totalCount;

  const toggleSection = useCallback((id: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectPr = useCallback(
    (item: EnrichedDashboardPr) => {
      const { pr } = item;

      void ipc("prActivity.markSeen", {
        repo: pr.workspacePath,
        prNumber: pr.number,
        updatedAt: pr.updatedAt,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["pr-activity"] }))
        .catch(() => {});

      if (pr.workspacePath !== cwd) {
        void ipc("workspace.setActive", { path: pr.workspacePath })
          .then(() => {
            switchWorkspace(pr.workspacePath);
            queryClient.invalidateQueries({ queryKey: ["workspace"] });
            navigate({ view: "review", prNumber: pr.number });
          })
          .catch(() => {});
        return;
      }

      navigate({ view: "review", prNumber: pr.number });
    },
    [cwd, navigate, switchWorkspace],
  );

  // Keyboard navigation
  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    {
      ...getBinding("navigation.prevPr"),
      handler: () => setFocusIndex((i) => Math.min(i + 1, flatPrs.length - 1)),
    },
    {
      ...getBinding("navigation.nextPr"),
      handler: () => setFocusIndex((i) => Math.max(i - 1, 0)),
    },
    {
      ...getBinding("navigation.openPr"),
      handler: () => {
        const item = flatPrs[focusIndex];
        if (item) {
          handleSelectPr(item);
        }
      },
    },
    {
      ...getBinding("search.focusSearch"),
      handler: () => searchRef.current?.focus(),
    },
  ]);

  // Close repo dropdown on outside click
  const handleRepoDropdownBlur = useCallback((e: React.FocusEvent) => {
    if (!repoRef.current?.contains(e.relatedTarget as Node)) {
      setRepoDropdownOpen(false);
    }
  }, []);

  const handleRefreshHome = useCallback(() => {
    void Promise.allSettled([
      userQuery.refetch(),
      repoInfoQuery.refetch(),
      allQuery.refetch(),
      reviewQuery.refetch(),
      allEnrichmentQuery.refetch(),
      workspaceCountsQuery.refetch(),
      prActivityQuery.refetch(),
      workspacesQuery.refetch(),
    ]).then((results) => {
      const hasFailure = results.some(
        (result) =>
          result.status === "rejected" || result.value.isError || result.value.isRefetchError,
      );

      if (hasFailure) {
        toastManager.add({
          title: "Refresh failed",
          description: "Some homepage data could not be updated.",
          type: "error",
        });
      }
    });
  }, [
    allEnrichmentQuery,
    allQuery,
    prActivityQuery,
    repoInfoQuery,
    reviewQuery,
    userQuery,
    workspaceCountsQuery,
    workspacesQuery,
  ]);

  const isLoading =
    allQuery.isLoading ||
    allEnrichmentQuery.isLoading ||
    reviewQuery.isLoading ||
    repoInfoQuery.isLoading;
  const isRefreshing =
    userQuery.isFetching ||
    repoInfoQuery.isFetching ||
    allQuery.isFetching ||
    reviewQuery.isFetching ||
    allEnrichmentQuery.isFetching ||
    workspaceCountsQuery.isFetching ||
    prActivityQuery.isFetching ||
    workspacesQuery.isFetching;

  return (
    <main
      aria-label="Pull request dashboard"
      className="relative flex h-full flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1040px] px-8 pt-5 pb-20">
          {/* Hero */}
          <div
            className="relative mb-5"
            role="status"
            aria-live="polite"
          >
            <div
              className="pointer-events-none absolute -top-[60px] left-[15%] h-[200px] w-[400px]"
              aria-hidden="true"
              style={{
                background:
                  "radial-gradient(ellipse, rgba(212, 136, 58, 0.035) 0%, transparent 70%)",
              }}
            />
            <span className="font-heading relative text-xl leading-tight tracking-[-0.02em] italic">
              {isLoading ? (
                <span className="text-text-secondary">Loading your queue...</span>
              ) : attentionCount > 0 ? (
                <>
                  <strong className="text-text-primary font-bold">
                    {attentionCount} {attentionCount === 1 ? "item" : "items"}
                  </strong>{" "}
                  <span className="text-text-secondary">
                    {attentionCount === 1 ? "needs" : "need"} your attention
                    {totalCount > attentionCount ? (
                      <>
                        {" "}
                        out of{" "}
                        <strong className="text-text-primary font-normal">
                          {totalCount} {totalCount === 1 ? "pull request" : "pull requests"}
                        </strong>
                      </>
                    ) : null}
                  </span>
                </>
              ) : totalCount > 0 ? (
                <>
                  <strong className="text-text-primary font-normal">
                    {totalCount} pull requests
                  </strong>{" "}
                  <span className="text-text-secondary">across your queue</span>
                </>
              ) : (
                <span className="text-text-secondary">You're all caught up</span>
              )}
            </span>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex items-center gap-2.5">
            {/* Repo selector */}
            <RepoSelector
              cwd={cwd}
              repoName={repoName}
              activeWorkspaceCount={activeWorkspaceCount}
              workspaces={workspacesQuery.data ?? []}
              workspaceCounts={workspaceCounts}
              open={repoDropdownOpen}
              onToggle={() => setRepoDropdownOpen((v) => !v)}
              onSelect={(ws) => {
                ipc("workspace.setActive", { path: ws.path })
                  .then(() => {
                    switchWorkspace(ws.path);
                    queryClient.invalidateQueries();
                    navigate({ view: "review", prNumber: null });
                  })
                  .catch(() => {});
                setRepoDropdownOpen(false);
              }}
              onAddRepo={() => {
                ipc("workspace.pickFolder")
                  .then((result) => {
                    if (result) {
                      return ipc("workspace.add", { path: result }).then(() =>
                        ipc("workspace.setActive", { path: result }).then(() => {
                          switchWorkspace(result);
                          queryClient.invalidateQueries();
                          navigate({ view: "review", prNumber: null });
                        }),
                      );
                    }
                  })
                  .catch(() => {});
                setRepoDropdownOpen(false);
              }}
              containerRef={repoRef}
              onBlur={handleRepoDropdownBlur}
            />

            {/* Search */}
            <div
              className="border-border bg-bg-surface focus-within:border-border-strong flex flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors"
              role="search"
            >
              <Search
                size={14}
                className="text-text-tertiary shrink-0"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                aria-label="Search pull requests"
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFocusIndex(-1);
                }}
                placeholder="Search PRs — title, #number, @author..."
                className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (searchQuery) {
                      setSearchQuery("");
                    } else {
                      (e.target as HTMLElement).blur();
                    }
                  }
                }}
              />
              <Kbd className="h-[18px] min-w-[18px] px-1 text-[9px]">/</Kbd>
            </div>

            <button
              type="button"
              onClick={handleRefreshHome}
              disabled={isRefreshing}
              aria-label="Refresh homepage pull requests"
              className="border-border bg-bg-surface text-text-secondary hover:border-border-strong hover:bg-bg-raised hover:text-text-primary inline-flex h-[31px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-all disabled:cursor-default disabled:opacity-60"
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>

          {/* Loading */}
          {isLoading && (
            <div
              className="flex items-center justify-center py-20"
              role="status"
              aria-label="Loading pull requests"
            >
              <Spinner
                className="text-text-tertiary h-5 w-5"
                aria-hidden="true"
              />
              <span className="sr-only">Loading pull requests</span>
            </div>
          )}

          {/* Sections */}
          {!isLoading &&
            totalCount > 0 &&
            filteredSections.map((section, sectionIndex) => (
              <PrSectionView
                key={section.id}
                section={section}
                collapsed={collapsedSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                currentUser={currentUser}
                nameFormat={nameFormat}
                onSelectPr={handleSelectPr}
                focusIndex={focusIndex}
                flatPrs={flatPrs}
                animationDelay={sectionIndex * 0.03}
              />
            ))}

          {/* Empty search */}
          {!isLoading && filteredCount === 0 && searchQuery.trim() && (
            <div
              className="flex flex-col items-center gap-2 py-20"
              role="status"
            >
              <Search
                size={20}
                className="text-text-ghost"
                aria-hidden="true"
              />
              <p className="text-text-secondary text-xs">No PRs match your search.</p>
            </div>
          )}

          {/* Empty state — all caught up */}
          {!isLoading && totalCount === 0 && !searchQuery.trim() && (
            <div className="flex flex-col items-center gap-2 py-20">
              <p className="font-heading text-text-secondary text-xl italic">Nothing here yet</p>
              <p className="text-text-secondary text-[13px]">
                Open some pull requests to see them here.
              </p>
            </div>
          )}

          {/* Footer keyboard hints */}
          {!isLoading && flatPrs.length > 0 && (
            <div className="border-border-subtle mt-2 flex items-center gap-4 border-t pt-4">
              <KbdHint
                keys={["j", "k"]}
                label="navigate"
              />
              <KbdHint
                keys={["\u21B5"]}
                label="open"
              />
              <KbdHint
                keys={["/"]}
                label="search"
              />
              <KbdHint
                keys={["\u2318K"]}
                label="palette"
              />
              <KbdHint
                keys={["?"]}
                label="shortcuts"
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
