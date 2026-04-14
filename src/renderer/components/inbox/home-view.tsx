/* eslint-disable import/max-dependencies -- The home view intentionally centralizes dashboard data and section rendering for the main workspace surface. */
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { AddRepoDialog } from "@/renderer/components/shared/add-repo-dialog";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { usePrSearchRefreshOnMiss } from "@/renderer/hooks/app/use-pr-search-refresh";
import { useDisplayNameFormat } from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  categorizeHomePrs,
  filterHomePrSections,
  getDashboardPrKey,
  type DashboardPr,
  type EnrichedDashboardPr,
  type SectionId,
  preferWorkspacePrs,
} from "@/renderer/lib/inbox/home-prs";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  getPrActivityKey,
  hasNewPrActivity,
  indexPrActivityStates,
} from "@/renderer/lib/review/pr-activity";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { KbdHint, PrSectionView, RepoSelector } from "./home-view-parts";
import { SearchHelpPopover } from "./search-autocomplete";

// ---------------------------------------------------------------------------
// HomeView
// ---------------------------------------------------------------------------

export function HomeView() {
  const { cwd, nwo, repoTarget, repo, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();
  const nameFormat = useDisplayNameFormat();
  const repoName = repo;

  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionId>>(
    new Set(["completed"]),
  );
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const repoRef = useRef<HTMLDivElement>(null);

  // Current user
  const userQuery = useQuery({
    queryKey: ["env", "user"],
    queryFn: () => ipc("env.user"),
    staleTime: 300_000,
  });
  const currentUser = userQuery.data?.login ?? null;

  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
    staleTime: 60_000,
  });

  // Open PRs across workspaces, matching the homepage queue view.
  const allQuery = useQuery({
    queryKey: ["pr", "listAll", "all", "open"],
    queryFn: () => ipc("pr.listAll", { filter: "all", state: "open" }),
    refetchInterval: 30_000,
  });

  // Review-requested PRs across workspaces.
  const reviewQuery = useQuery({
    queryKey: ["pr", "listAll", "reviewRequested", "open"],
    queryFn: () => ipc("pr.listAll", { filter: "reviewRequested", state: "open" }),
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

  const repoIdentity = repoInfoQuery.data?.nameWithOwner ?? repoName;
  const pullRequestRepository = repoInfoQuery.data?.parent ?? repoIdentity;
  const isForkWorkspace = repoInfoQuery.data?.isFork ?? false;
  const [targetRepoOwner = "", targetRepoName = ""] = pullRequestRepository.split("/");

  const targetRepoQuery = useQuery({
    queryKey: ["repo", "info", "target", pullRequestRepository],
    queryFn: () =>
      ipc("repo.info", {
        owner: targetRepoOwner,
        repo: targetRepoName,
        cwd: null,
      }),
    enabled: isForkWorkspace && targetRepoOwner !== "" && targetRepoName !== "",
  });

  const canMergeTargetRepo = isForkWorkspace
    ? (targetRepoQuery.data?.canPush ?? repoInfoQuery.data?.canPush ?? true)
    : (repoInfoQuery.data?.canPush ?? true);

  const decoratePr = useCallback(
    (pr: DashboardPr): EnrichedDashboardPr => ({
      pr,
      hasNewActivity: hasNewPrActivity(
        pr.updatedAt,
        prActivityIndex.get(getPrActivityKey(pr.workspacePath, pr.number)),
      ),
    }),
    [prActivityIndex],
  );

  const allPrs = useMemo(
    () =>
      preferWorkspacePrs(
        (allQuery.data ?? []).map((pr) =>
          decoratePr({
            ...pr,
            workspace: pr.workspace,
            workspacePath: pr.workspacePath ?? cwd ?? nwo,
            repository: pr.repository,
            pullRequestRepository: pr.pullRequestRepository,
            isForkWorkspace: pr.isForkWorkspace,
          }),
        ),
        cwd ?? nwo,
      ),
    [allQuery.data, cwd, nwo, decoratePr],
  );

  const reviewRequestedKeys = useMemo(
    () =>
      new Set(
        (reviewQuery.data ?? []).map((pr) =>
          getDashboardPrKey(pr.pullRequestRepository, pr.number),
        ),
      ),
    [reviewQuery.data],
  );

  // Categorize into sections
  const sections = useMemo(
    () => categorizeHomePrs(allPrs, reviewRequestedKeys, currentUser, canMergeTargetRepo),
    [allPrs, canMergeTargetRepo, currentUser, reviewRequestedKeys],
  );

  // Search filter
  const filteredSections = useMemo(
    () => filterHomePrSections(sections, searchQuery),
    [searchQuery, sections],
  );
  const filteredCount = useMemo(
    () => filteredSections.reduce((sum, section) => sum + section.items.length, 0),
    [filteredSections],
  );
  const searchRefreshRequests = useMemo(
    () => [
      {
        method: "pr.listAll" as const,
        args: { filter: "all" as const, state: "open" as const },
        queryKey: ["pr", "listAll", "all", "open"],
      },
      {
        method: "pr.listAll" as const,
        args: { filter: "reviewRequested" as const, state: "open" as const },
        queryKey: ["pr", "listAll", "reviewRequested", "open"],
      },
    ],
    [],
  );

  usePrSearchRefreshOnMiss({
    scope: `home:${nwo}`,
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
    () =>
      sections
        .filter((s) => s.id === "attention" || s.id === "reReview")
        .reduce((sum, section) => sum + section.items.length, 0),
    [sections],
  );

  const totalCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.items.length, 0),
    [sections],
  );

  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const pr of allQuery.data ?? []) {
      const wsKey = pr.workspacePath ?? "";
      counts.set(wsKey, (counts.get(wsKey) ?? 0) + 1);
    }

    return counts;
  }, [allQuery.data]);

  const activeWorkspaceCount = workspaceCounts.get(cwd ?? nwo) ?? 0;

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

      const prRepo = pr.repository ?? pr.pullRequestRepository;
      const prNwo = `${prRepo.split("/")[0]}/${prRepo.split("/")[1]}`;
      if (prNwo !== nwo) {
        const targetWs = (workspacesQuery.data ?? []).find(
          (ws: { owner: string; repo: string; path: string | null }) =>
            `${ws.owner}/${ws.repo}` === prNwo || ws.path === pr.workspacePath,
        );
        if (targetWs) {
          void ipc("workspace.setActive", { id: targetWs.id })
            .then(() => {
              switchWorkspace({
                id: targetWs.id,
                owner: targetWs.owner,
                repo: targetWs.repo,
                path: targetWs.path,
              });
              queryClient.invalidateQueries({ queryKey: ["workspace"] });
              navigate({ view: "review", prNumber: pr.number });
            })
            .catch(() => {});
        }
        return;
      }

      navigate({ view: "review", prNumber: pr.number });
    },
    [navigate, switchWorkspace],
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
  }, [allQuery, prActivityQuery, repoInfoQuery, reviewQuery, userQuery, workspacesQuery]);

  const isLoading = allQuery.isLoading || reviewQuery.isLoading || repoInfoQuery.isLoading;
  const isRefreshing =
    userQuery.isFetching ||
    repoInfoQuery.isFetching ||
    allQuery.isFetching ||
    reviewQuery.isFetching ||
    prActivityQuery.isFetching ||
    workspacesQuery.isFetching;

  return (
    <>
      <AddRepoDialog
        open={addRepoOpen}
        onOpenChange={setAddRepoOpen}
        onAdded={(ws) => {
          switchWorkspace({ id: ws.id, owner: ws.owner, repo: ws.repo, path: ws.path });
          queryClient.invalidateQueries();
          navigate({ view: "review", prNumber: null });
        }}
      />
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
              <div className="relative flex max-w-[760px] flex-col">
                <h1 className="text-text-primary text-[23px] leading-[1.12] font-semibold tracking-[-0.03em]">
                  {isLoading ? (
                    <span className="text-text-secondary">Loading your queue...</span>
                  ) : attentionCount > 0 ? (
                    <>
                      <span className="text-accent-text font-mono text-[0.88em] font-semibold">
                        {attentionCount}
                      </span>{" "}
                      <span className="text-text-primary">
                        {attentionCount === 1 ? "item" : "items"}
                      </span>{" "}
                      <span className="text-text-secondary">
                        {attentionCount === 1 ? "needs" : "need"} your attention
                      </span>
                      {totalCount > attentionCount ? (
                        <>
                          <span className="text-text-secondary"> out of </span>
                          <span className="text-text-primary">
                            <span className="font-mono text-[0.88em] font-medium">
                              {totalCount}
                            </span>{" "}
                            {totalCount === 1 ? "pull request" : "pull requests"}
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : totalCount > 0 ? (
                    <>
                      <span className="text-accent-text font-mono text-[0.88em] font-semibold">
                        {totalCount}
                      </span>{" "}
                      <span className="text-text-primary">
                        {totalCount === 1 ? "pull request" : "pull requests"}
                      </span>{" "}
                      <span className="text-text-secondary">across your queue</span>
                    </>
                  ) : (
                    <>
                      <span className="text-text-primary">Queue is empty.</span>{" "}
                      <span className="text-text-secondary">
                        No pull requests in your queue yet.
                      </span>
                    </>
                  )}
                </h1>
              </div>
            </div>

            {/* Toolbar */}
            <div className="mb-4 flex items-center gap-2.5">
              {/* Repo selector */}
              <RepoSelector
                cwd={cwd ?? nwo}
                repoName={repoName}
                activeWorkspaceCount={activeWorkspaceCount}
                workspaces={workspacesQuery.data ?? []}
                workspaceCounts={workspaceCounts}
                open={repoDropdownOpen}
                onToggle={() => setRepoDropdownOpen((v) => !v)}
                onSelect={(ws) => {
                  switchWorkspace({ id: ws.id, owner: ws.owner, repo: ws.repo, path: ws.path });
                  queryClient.invalidateQueries();
                  navigate({ view: "review", prNumber: null });
                  setRepoDropdownOpen(false);
                }}
                onAddRepo={() => {
                  setRepoDropdownOpen(false);
                  setAddRepoOpen(true);
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
                  placeholder="Search PRs — @author, repo:dispatch, (review:changes OR state:merged)"
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
                <SearchHelpPopover />
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
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-text-primary text-[18px] font-medium tracking-[-0.02em]">
                  No pull requests yet
                </p>
                <p className="text-text-secondary max-w-sm text-[13px]">
                  Open some pull requests in one of your workspaces to see them here.
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
    </>
  );
}
