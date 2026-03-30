import type { GhPrEnrichment, GhPrListItemCore, Workspace } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Eye,
  GitMerge,
  Loader2,
  Pencil,
  Plus,
  Search,
  Star,
  XCircle,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { formatAuthorName, useDisplayNameFormat } from "../hooks/use-display-name";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { ipc } from "../lib/ipc";
import { useKeybindings } from "../lib/keybinding-context";
import { getPrActivityKey, hasNewPrActivity, indexPrActivityStates } from "../lib/pr-activity";
import { summarizePrChecks, type PrCheckSummary } from "../lib/pr-check-status";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrichedPr {
  pr: GhPrListItemCore;
  enrichment?: GhPrEnrichment;
  checkSummary: PrCheckSummary;
  hasNewActivity: boolean;
}

type SectionId = "attention" | "ship" | "progress" | "completed";

interface PrSection {
  id: SectionId;
  title: string;
  items: EnrichedPr[];
  defaultCollapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Compact relative time ("38m", "2h", "1d")
// ---------------------------------------------------------------------------

function compactTime(dateStr: string): { short: string; full: string } {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0 || Number.isNaN(ms)) {
    return { short: "now", full: "just now" };
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) {
    return { short: "now", full: "just now" };
  }
  if (mins < 60) {
    return { short: `${mins}m`, full: `${mins} minute${mins === 1 ? "" : "s"} ago` };
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return { short: `${hrs}h`, full: `${hrs} hour${hrs === 1 ? "" : "s"} ago` };
  }
  const days = Math.floor(hrs / 24);
  return { short: `${days}d`, full: `${days} day${days === 1 ? "" : "s"} ago` };
}

// ---------------------------------------------------------------------------
// Size badge
// ---------------------------------------------------------------------------

function prSizeLabel(
  additions: number,
  deletions: number,
): { label: string; fullLabel: string; cls: string } | null {
  const total = additions + deletions;
  if (total === 0) {
    return null;
  }
  if (total < 50) {
    return { label: "S", fullLabel: "Small change", cls: "bg-success-muted text-success" };
  }
  if (total < 200) {
    return { label: "M", fullLabel: "Medium change", cls: "bg-warning-muted text-warning" };
  }
  if (total < 500) {
    return {
      label: "L",
      fullLabel: "Large change",
      cls: "bg-[rgba(232,166,85,0.12)] text-accent-text",
    };
  }
  return {
    label: "XL",
    fullLabel: "Extra large change",
    cls: "bg-danger-muted text-destructive",
  };
}

// ---------------------------------------------------------------------------
// Categorize PRs into sections
// ---------------------------------------------------------------------------

function categorizePrs(authored: EnrichedPr[], reviewRequested: EnrichedPr[]): PrSection[] {
  const attention: EnrichedPr[] = [];
  const ship: EnrichedPr[] = [];
  const progress: EnrichedPr[] = [];
  const completed: EnrichedPr[] = [];

  // Deduplicate across authored + reviewRequested
  const seen = new Set<number>();

  // Review-requested PRs always go to attention (if open)
  for (const item of reviewRequested) {
    if (seen.has(item.pr.number)) {
      continue;
    }
    seen.add(item.pr.number);
    if (item.pr.state === "MERGED") {
      completed.push(item);
    } else if (item.pr.state === "CLOSED") {
      completed.push(item);
    } else {
      attention.push(item);
    }
  }

  // Authored PRs — categorize by status
  for (const item of authored) {
    if (seen.has(item.pr.number)) {
      continue;
    }
    seen.add(item.pr.number);

    if (item.pr.state === "MERGED" || item.pr.state === "CLOSED") {
      completed.push(item);
      continue;
    }

    // Needs attention: CI failing or changes requested on your PRs
    if (
      item.checkSummary.state === "failing" ||
      item.pr.reviewDecision === "CHANGES_REQUESTED" ||
      item.enrichment?.mergeable === "CONFLICTING"
    ) {
      attention.push(item);
      continue;
    }

    // Ready to ship: approved + CI passing
    if (
      !item.pr.isDraft &&
      item.pr.reviewDecision === "APPROVED" &&
      item.checkSummary.state === "passing"
    ) {
      ship.push(item);
      continue;
    }

    // Everything else is in progress
    progress.push(item);
  }

  const sections: PrSection[] = [];

  if (attention.length > 0) {
    sections.push({ id: "attention", title: "Needs your attention", items: attention });
  }
  if (ship.length > 0) {
    sections.push({ id: "ship", title: "Ready to ship", items: ship });
  }
  if (progress.length > 0) {
    sections.push({ id: "progress", title: "In progress", items: progress });
  }
  if (completed.length > 0) {
    sections.push({
      id: "completed",
      title: "Recently completed",
      items: completed,
      defaultCollapsed: true,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Status tag resolver
// ---------------------------------------------------------------------------

interface StatusTag {
  label: string;
  colorClass: string;
  icon: "review" | "changes" | "failing" | "approved" | "waiting" | "running" | "draft" | "merged";
}

function resolveStatusTag(
  pr: GhPrListItemCore,
  checkSummary: PrCheckSummary,
  currentUser: string | null,
): StatusTag | null {
  if (pr.state === "MERGED") {
    return { label: "Merged", colorClass: "text-purple opacity-60", icon: "merged" };
  }
  if (pr.isDraft) {
    return { label: "Draft", colorClass: "text-text-secondary", icon: "draft" };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { label: "Changes requested", colorClass: "text-warning", icon: "changes" };
  }
  if (pr.reviewDecision === "APPROVED") {
    return {
      label: checkSummary.state === "passing" ? `Approved` : "Approved",
      colorClass: "text-success",
      icon: "approved",
    };
  }
  // Check if review is requested from current user
  if (pr.reviewDecision === "REVIEW_REQUIRED" || pr.reviewDecision === "") {
    // If the current user is the author, show "Awaiting review"
    if (currentUser && pr.author.login === currentUser) {
      return { label: "Awaiting review", colorClass: "text-text-secondary", icon: "waiting" };
    }
    return { label: "Review requested", colorClass: "text-purple", icon: "review" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Color bar resolver
// ---------------------------------------------------------------------------

function resolveBarColor(
  pr: GhPrListItemCore,
  checkSummary: PrCheckSummary,
  currentUser: string | null,
): string {
  if (pr.state === "MERGED") {
    return "bg-purple opacity-30";
  }
  if (pr.state === "CLOSED") {
    return "bg-destructive opacity-30";
  }
  if (pr.isDraft) {
    return "bg-text-ghost";
  }
  if (checkSummary.state === "failing") {
    return "bg-destructive";
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return "bg-warning";
  }
  if (pr.reviewDecision === "APPROVED" && checkSummary.state === "passing") {
    return "bg-success";
  }
  if (checkSummary.state === "pending") {
    return "bg-info";
  }
  if (currentUser && pr.author.login !== currentUser) {
    return "bg-purple";
  }
  if (currentUser && pr.author.login === currentUser && pr.reviewDecision === "APPROVED") {
    return "bg-success";
  }
  return "bg-purple opacity-40";
}

// ---------------------------------------------------------------------------
// HomeView
// ---------------------------------------------------------------------------

export function HomeView() {
  const { cwd, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();
  const nameFormat = useDisplayNameFormat();

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

  // Authored PRs
  const authoredQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
  });

  // Review-requested PRs
  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    refetchInterval: 30_000,
  });

  // Enrichment for both
  const authoredEnrichmentQuery = useQuery({
    queryKey: ["pr", "enrichment", cwd, "authored"],
    queryFn: () => ipc("pr.listEnrichment", { cwd, filter: "authored" }),
    refetchInterval: 30_000,
  });
  const reviewEnrichmentQuery = useQuery({
    queryKey: ["pr", "enrichment", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.listEnrichment", { cwd, filter: "reviewRequested" }),
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
  const authoredEnrichmentIndex = useMemo(() => {
    const map = new Map<number, GhPrEnrichment>();
    for (const e of authoredEnrichmentQuery.data ?? []) {
      map.set(e.number, e);
    }
    return map;
  }, [authoredEnrichmentQuery.data]);

  const reviewEnrichmentIndex = useMemo(() => {
    const map = new Map<number, GhPrEnrichment>();
    for (const e of reviewEnrichmentQuery.data ?? []) {
      map.set(e.number, e);
    }
    return map;
  }, [reviewEnrichmentQuery.data]);

  // Enrich PR lists
  const enrichPr = useCallback(
    (pr: GhPrListItemCore, enrichmentIndex: Map<number, GhPrEnrichment>): EnrichedPr => {
      const enrichment = enrichmentIndex.get(pr.number);
      return {
        pr,
        enrichment,
        checkSummary: summarizePrChecks(enrichment?.statusCheckRollup ?? []),
        hasNewActivity: hasNewPrActivity(
          pr.updatedAt,
          prActivityIndex.get(getPrActivityKey(cwd, pr.number)),
        ),
      };
    },
    [cwd, prActivityIndex],
  );

  const authoredPrs = useMemo(
    () => (authoredQuery.data ?? []).map((pr) => enrichPr(pr, authoredEnrichmentIndex)),
    [authoredQuery.data, authoredEnrichmentIndex, enrichPr],
  );

  const reviewPrs = useMemo(
    () => (reviewQuery.data ?? []).map((pr) => enrichPr(pr, reviewEnrichmentIndex)),
    [reviewQuery.data, reviewEnrichmentIndex, enrichPr],
  );

  // Categorize into sections
  const sections = useMemo(() => categorizePrs(authoredPrs, reviewPrs), [authoredPrs, reviewPrs]);

  // Search filter
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) {
      return sections;
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

  const repoName = cwd.split("/").pop() ?? "";

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
    (pr: GhPrListItemCore) => {
      void ipc("prActivity.markSeen", {
        repo: cwd,
        prNumber: pr.number,
        updatedAt: pr.updatedAt,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["pr-activity"] }))
        .catch(() => {});
      navigate({ view: "review", prNumber: pr.number });
    },
    [cwd, navigate],
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
          handleSelectPr(item.pr);
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

  const isLoading = authoredQuery.isLoading || reviewQuery.isLoading;

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
                  <strong className="text-text-primary font-normal">
                    {attentionCount} {attentionCount === 1 ? "item" : "items"}
                  </strong>{" "}
                  <span className="text-text-secondary">
                    {attentionCount === 1 ? "needs" : "need"} your attention
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
              totalCount={totalCount}
              workspaces={workspacesQuery.data ?? []}
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
            filteredSections.map((section, sectionIndex) => (
              <PrSectionView
                key={section.id}
                section={section}
                collapsed={collapsedSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                currentUser={currentUser}
                nameFormat={nameFormat}
                cwd={cwd}
                onSelectPr={handleSelectPr}
                focusIndex={focusIndex}
                flatPrs={flatPrs}
                animationDelay={sectionIndex * 0.03}
              />
            ))}

          {/* Empty search */}
          {!isLoading && filteredSections.length === 0 && searchQuery.trim() && (
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
          {!isLoading && sections.length === 0 && !searchQuery.trim() && (
            <div className="flex flex-col items-center gap-2 py-20">
              <p className="font-heading text-text-secondary text-xl italic">Nothing here yet</p>
              <p className="text-text-secondary text-[13px]">
                Open some pull requests to see them here.
              </p>
            </div>
          )}

          {/* Footer keyboard hints */}
          {!isLoading && filteredSections.length > 0 && (
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

// ---------------------------------------------------------------------------
// Repo selector dropdown
// ---------------------------------------------------------------------------

function RepoSelector({
  cwd,
  repoName,
  totalCount,
  workspaces,
  open,
  onToggle,
  onSelect,
  onAddRepo,
  containerRef,
  onBlur,
}: {
  cwd: string;
  repoName: string;
  totalCount: number;
  workspaces: Workspace[];
  open: boolean;
  onToggle: () => void;
  onSelect: (ws: Workspace) => void;
  onAddRepo: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onBlur: (e: React.FocusEvent) => void;
}) {
  const [repoSearch, setRepoSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!repoSearch.trim()) {
      return workspaces;
    }
    const q = repoSearch.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(q));
  }, [workspaces, repoSearch]);

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      onBlur={onBlur}
    >
      <button
        type="button"
        onClick={() => {
          onToggle();
          if (!open) {
            setRepoSearch("");
            setTimeout(() => searchInputRef.current?.focus(), 40);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Repository: ${repoName}. ${totalCount} pull requests`}
        className={`border-border bg-bg-surface hover:border-border-strong hover:bg-bg-raised flex cursor-pointer items-center gap-[7px] rounded-md border px-2.5 py-1.5 transition-all ${open ? "border-border-strong bg-bg-raised" : ""}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          className="text-accent-text shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
          <path d="M9 18c-4.51 2-5-2-7-2" />
        </svg>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{repoName}</span>
        {totalCount > 0 && (
          <span
            className="bg-accent-muted text-accent-text flex h-4 min-w-4 items-center justify-center rounded-full px-[5px] font-mono text-[9px] font-semibold"
            aria-hidden="true"
          >
            {totalCount}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`text-text-ghost transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="border-border-strong bg-bg-elevated absolute top-[calc(100%+6px)] left-0 z-[100] flex w-[300px] flex-col overflow-hidden rounded-lg border shadow-lg"
          role="listbox"
          aria-label="Select repository"
        >
          {/* Search */}
          <div className="border-border flex items-center gap-2 border-b px-2.5 py-2">
            <Search
              size={13}
              className="text-text-tertiary shrink-0"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={repoSearch}
              aria-label="Filter repositories"
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Find a repository..."
              className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onToggle();
                }
              }}
            />
          </div>

          {/* Workspace list */}
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map((ws) => {
              const isActive = ws.path === cwd;
              return (
                <button
                  key={ws.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    if (!isActive) {
                      onSelect(ws);
                    } else {
                      onToggle();
                    }
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${isActive ? "bg-accent-muted" : "hover:bg-bg-raised"}`}
                >
                  {isActive ? (
                    <Star
                      size={10}
                      className="text-warning shrink-0"
                      fill="currentColor"
                      aria-hidden="true"
                    />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      className="text-text-ghost shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5" />
                      <path d="M9 18c-4.51 2-5-2-7-2" />
                    </svg>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-medium ${isActive ? "text-text-primary" : ""}`}>
                      {ws.name}
                    </div>
                    <div className="text-text-tertiary truncate font-mono text-[10px]">
                      {ws.path}
                    </div>
                  </div>
                  {isActive && (
                    <Check
                      size={13}
                      className="text-success shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Add repo */}
          <div className="border-border border-t p-1">
            <button
              type="button"
              onClick={onAddRepo}
              className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition-all"
            >
              <Plus size={12} />
              Add repository...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function PrSectionView({
  section,
  collapsed,
  onToggle,
  currentUser,
  nameFormat,
  cwd,
  onSelectPr,
  focusIndex,
  flatPrs,
  animationDelay,
}: {
  section: PrSection;
  collapsed: boolean;
  onToggle: () => void;
  currentUser: string | null;
  nameFormat: "login" | "name";
  cwd: string;
  onSelectPr: (pr: GhPrListItemCore) => void;
  focusIndex: number;
  flatPrs: EnrichedPr[];
  animationDelay: number;
}) {
  const sectionClass = section.id === "attention" ? "rounded-lg -mx-0.5 px-0.5" : "";

  const bodyClass =
    section.id === "attention"
      ? "bg-[rgba(212,136,58,0.028)] rounded-b-lg border-t border-[rgba(212,136,58,0.08)]"
      : "border-t border-border-subtle";

  const titleClass = section.id === "attention" ? "text-accent-text" : "text-text-secondary";

  return (
    <div
      className={`mb-1 ${sectionClass}`}
      style={{
        animation: `fadeSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both`,
        animationDelay: `${animationDelay}s`,
      }}
    >
      <div className="flex items-center gap-1.5 px-0.5 pt-2.5 pb-1.5">
        <span
          id={`section-label-${section.id}`}
          className={`text-[11px] font-semibold tracking-[0.01em] ${titleClass}`}
        >
          {section.title}
        </span>
        <span
          className="text-text-secondary font-mono text-[10px]"
          aria-label={`${section.items.length} pull requests`}
        >
          {section.items.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-labelledby={`section-label-${section.id}`}
          className="text-text-tertiary cursor-pointer p-0.5 transition-transform"
          style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}
        >
          <ChevronDown
            size={13}
            aria-hidden="true"
          />
        </button>
      </div>

      {!collapsed && (
        <div className={bodyClass}>
          {section.items.map((item) => {
            const flatIdx = flatPrs.indexOf(item);
            return (
              <PrRow
                key={item.pr.number}
                item={item}
                currentUser={currentUser}
                nameFormat={nameFormat}
                cwd={cwd}
                onClick={() => onSelectPr(item.pr)}
                isFocused={flatIdx === focusIndex}
                isShipSection={section.id === "ship"}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PR Row
// ---------------------------------------------------------------------------

function PrRow({
  item,
  currentUser,
  nameFormat,
  cwd,
  onClick,
  isFocused,
  isShipSection,
}: {
  item: EnrichedPr;
  currentUser: string | null;
  nameFormat: "login" | "name";
  cwd: string;
  onClick: () => void;
  isFocused: boolean;
  isShipSection: boolean;
}) {
  const { pr, enrichment, checkSummary, hasNewActivity } = item;
  const statusTag = resolveStatusTag(pr, checkSummary, currentUser);
  const barColor = resolveBarColor(pr, checkSummary, currentUser);
  const size = enrichment ? prSizeLabel(enrichment.additions, enrichment.deletions) : null;
  const isDim = pr.state === "MERGED" || pr.state === "CLOSED" || pr.isDraft;
  const isAuthor = currentUser && pr.author.login === currentUser;
  const authorDisplay = isAuthor ? "you" : formatAuthorName(pr.author, nameFormat);

  const mergeMutation = useMutation({
    mutationFn: () => ipc("pr.merge", { cwd, prNumber: pr.number, strategy: "squash" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: result.queued ? `PR #${pr.number} added to merge queue` : `PR #${pr.number} merged`,
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({ title: "Merge failed", description: String(err.message), type: "error" });
    },
  });

  const prLabel = `${pr.title}, #${pr.number} by ${authorDisplay}${statusTag ? `, ${statusTag.label}` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={prLabel}
      className={`border-border-subtle flex w-full cursor-pointer items-stretch border-b text-left transition-colors last:border-b-0 ${
        isFocused
          ? "bg-accent-muted"
          : isDim && !isShipSection
            ? "hover:bg-bg-raised"
            : isShipSection
              ? "bg-[rgba(61,214,140,0.02)] hover:bg-[rgba(61,214,140,0.05)]"
              : "hover:bg-bg-raised"
      }`}
      style={{ minHeight: 48 }}
    >
      {/* Color bar (decorative) */}
      <div
        className={`w-0.5 shrink-0 rounded-r-sm opacity-80 ${barColor}`}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="min-w-0 flex-1 px-2.5 py-[7px]">
        {/* Line 1: title + time (+ merge button for ship) */}
        <div className="flex items-baseline gap-2.5">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${isDim ? "text-text-secondary font-normal" : "text-text-primary font-medium"}`}
          >
            {pr.title}
          </span>

          {/* Ship section: reviewer avatars + merge button */}
          {isShipSection && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  mergeMutation.mutate();
                }}
                disabled={mergeMutation.isPending}
                aria-label={`Merge pull request #${pr.number}`}
                className="bg-success flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-[#08080a] transition-all hover:shadow-[0_0_12px_rgba(61,214,140,0.15)] hover:brightness-110 disabled:opacity-60"
              >
                {mergeMutation.isPending ? (
                  <Spinner className="h-[11px] w-[11px]" />
                ) : mergeMutation.isSuccess ? (
                  <Check
                    size={11}
                    strokeWidth={2.5}
                  />
                ) : (
                  <GitMerge
                    size={11}
                    strokeWidth={2.5}
                  />
                )}
                {mergeMutation.isSuccess ? "Merged!" : "Merge"}
              </button>
            </div>
          )}

          {!isShipSection && (
            <time
              dateTime={pr.updatedAt}
              title={compactTime(pr.updatedAt).full}
              className="text-text-tertiary shrink-0 font-mono text-[10px]"
            >
              {compactTime(pr.updatedAt).short}
            </time>
          )}
        </div>

        {/* Line 2: identity + status */}
        <div className="mt-px flex items-center gap-1.5">
          {/* Left: #num · author */}
          <div className="flex min-w-0 items-center gap-1">
            <span className="text-text-secondary shrink-0 font-mono text-[10px]">#{pr.number}</span>
            <span
              className="text-text-ghost text-[9px]"
              aria-hidden="true"
            >
              &middot;
            </span>
            <span className="text-text-secondary text-[11px] font-[450]">{authorDisplay}</span>
          </div>

          <div className="flex-1" />

          {/* Right: status tag + CI + size + activity dot */}
          <div className="flex shrink-0 items-center gap-1.5">
            {statusTag && <StatusTagBadge tag={statusTag} />}

            <CiBadge checkSummary={checkSummary} />

            {isShipSection && enrichment && (
              <span
                aria-label={`${enrichment.additions} additions, ${enrichment.deletions} deletions`}
              >
                <span
                  className="text-success font-mono text-[10px]"
                  aria-hidden="true"
                >
                  +{enrichment.additions}
                </span>{" "}
                <span
                  className="text-destructive font-mono text-[10px]"
                  aria-hidden="true"
                >
                  &minus;{enrichment.deletions}
                </span>
              </span>
            )}

            {size && !isShipSection && (
              <span
                className={`rounded-xs px-1 font-mono text-[9px] leading-snug font-semibold ${size.cls}`}
                title={size.fullLabel}
                aria-label={size.fullLabel}
              >
                {size.label}
              </span>
            )}

            {hasNewActivity && (
              <span
                className="bg-primary h-[5px] w-[5px] shrink-0 rounded-full"
                role="img"
                aria-label="New activity"
              />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status tag badge
// ---------------------------------------------------------------------------

function StatusTagBadge({ tag }: { tag: StatusTag }) {
  return (
    <span
      className={`flex items-center gap-[3px] text-[10px] font-medium whitespace-nowrap ${tag.colorClass}`}
    >
      <StatusTagIcon icon={tag.icon} />
      {tag.label}
    </span>
  );
}

function StatusTagIcon({ icon }: { icon: StatusTag["icon"] }) {
  const cls = "h-[9px] w-[9px]";
  const sw = 2.5;
  const hidden = { "aria-hidden": true as const };

  switch (icon) {
    case "review": {
      return (
        <Eye
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "changes": {
      return (
        <Pencil
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "failing": {
      return (
        <XCircle
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "approved": {
      return (
        <Check
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "waiting": {
      return (
        <Loader2
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "running": {
      return (
        <Loader2
          size={9}
          strokeWidth={sw}
          className={`${cls} animate-spin`}
          {...hidden}
        />
      );
    }
    case "draft": {
      return (
        <Pencil
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
    case "merged": {
      return (
        <GitMerge
          size={9}
          strokeWidth={sw}
          className={cls}
          {...hidden}
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CI badge
// ---------------------------------------------------------------------------

function CiBadge({ checkSummary }: { checkSummary: PrCheckSummary }) {
  if (checkSummary.state === "none") {
    return null;
  }

  if (checkSummary.state === "failing") {
    const label =
      checkSummary.failed > 0 && checkSummary.total > checkSummary.failed
        ? `${checkSummary.passed} of ${checkSummary.total} checks passing`
        : `${checkSummary.failed} checks failed`;
    return (
      <span
        className="text-destructive flex items-center gap-0.5 font-mono text-[10px] font-medium"
        title={label}
      >
        <XCircle
          size={9}
          strokeWidth={2.5}
          aria-hidden="true"
        />
        {checkSummary.failed > 0 && checkSummary.total > checkSummary.failed
          ? `${checkSummary.passed}/${checkSummary.total}`
          : `${checkSummary.failed} failed`}
      </span>
    );
  }

  if (checkSummary.state === "pending") {
    return (
      <span
        className="text-warning flex items-center gap-0.5 font-mono text-[10px] font-medium"
        title={`${checkSummary.passed} of ${checkSummary.total} checks complete`}
      >
        <Loader2
          size={9}
          strokeWidth={2.5}
          className="animate-spin"
          aria-hidden="true"
        />
        {`${checkSummary.passed}/${checkSummary.total}`}
      </span>
    );
  }

  if (checkSummary.state === "passing") {
    return (
      <span
        className="text-success flex items-center gap-0.5 font-mono text-[10px] font-medium"
        title={`All ${checkSummary.total} checks passing`}
      >
        <Check
          size={9}
          strokeWidth={2.5}
          aria-hidden="true"
        />
        {checkSummary.total}
      </span>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Keyboard hint
// ---------------------------------------------------------------------------

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="text-text-tertiary flex items-center gap-1 text-[10px]">
      {keys.map((k) => (
        <Kbd
          key={k}
          className="h-[18px] min-w-[18px] px-1 text-[9px]"
        >
          {k}
        </Kbd>
      ))}
      <span>{label}</span>
    </div>
  );
}
