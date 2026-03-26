import type { GhPrEnrichment, GhPrListItemCore } from "@/shared/ipc";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
  commandMatch,
  useCommandFilters,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { toastManager } from "@/components/ui/toast";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Check,
  ClipboardCopy,
  Eye,
  ExternalLink,
  FileCode,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Keyboard,
  Layers,
  PanelRight,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Tag,
  XCircle,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { formatAuthorName, useDisplayNameFormat } from "../hooks/use-display-name";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { useFileNav } from "../lib/file-nav-context";
import { ipc } from "../lib/ipc";
import { useKeybindings } from "../lib/keybinding-context";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Command palette — ⌘K global search and action launcher.
 *
 * ## Smart filters
 *
 * Power-user structured filters parsed from the query:
 *
 * | Filter              | Example                     | Matches                        |
 * |---------------------|-----------------------------|--------------------------------|
 * | `#N` / `pr:N`       | `#3350`, `pr:100`           | Exact PR number                |
 * | `@name` / `author:` | `@john`, `author:jane`      | Author login (substring)       |
 * | `branch:`           | `branch:feat/new`           | Head or base branch            |
 * | `is:` / `state:`    | `is:draft`, `is:approved`   | PR state or review status      |
 * | `size:`             | `size:s`, `size:xl`         | Change size (xs/s/m/l/xl)      |
 * | `label:`            | `label:bug`                 | PR label name                  |
 * | `file:` / `ext:`    | `file:tsx`, `ext:css`       | File path / extension          |
 *
 * Remaining text after filters is used for free-text substring search.
 */

/** Resolve the real GitHub `owner/repo` slug from the git remote. */
function useRepoSlug(): string {
  const { cwd } = useWorkspace();
  const repoInfo = useQuery({
    queryKey: ["repo", "info", cwd],
    queryFn: () => ipc("repo.info", { cwd }),
    staleTime: 300_000,
  });
  return repoInfo.data?.nameWithOwner ?? "";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    { ...getBinding("search.commandPalette"), handler: () => setOpen(true) },
    { ...getBinding("search.commandPaletteAlt"), handler: () => setOpen(true) },
  ]);

  const close = () => setOpen(false);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
    >
      <CommandDialogPopup>
        <Command key={open ? "open" : "closed"}>
          <CommandInput placeholder="Search commands… #pr @author is:draft size:s" />
          <CommandPanel>
            <CommandList>
              <PullRequestGroup onSelect={close} />
              <FileGroup onSelect={close} />
              <ReviewActionsGroup onSelect={close} />
              <NavigationGroup onSelect={close} />
              <WorkspaceGroup onSelect={close} />
              <WorkflowGroup onSelect={close} />
              <GitGroup onSelect={close} />
              <SystemGroup onSelect={close} />
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑↓</Kbd>
                <span>navigate</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                <span>close</span>
              </span>
            </div>
            <span className="text-text-ghost text-[10px]">
              <Kbd>⌘K</Kbd> or <Kbd>⇧⌘P</Kbd>
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------
// Size classification for `size:` filter
// ---------------------------------------------------------------------------

type PrSize = "xs" | "s" | "m" | "l" | "xl";

function classifyPrSize(additions: number, deletions: number): PrSize {
  const total = additions + deletions;
  if (total < 10) return "xs";
  if (total < 50) return "s";
  if (total < 200) return "m";
  if (total < 500) return "l";
  return "xl";
}

// ---------------------------------------------------------------------------
// Pull Requests — quick jump to any open PR
// ---------------------------------------------------------------------------

function PullRequestGroup({ onSelect }: { onSelect: () => void }) {
  const filters = useCommandFilters();
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();
  const nameFormat = useDisplayNameFormat();

  const reviewQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    staleTime: 30_000,
  });
  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    staleTime: 30_000,
  });
  const allQuery = useQuery({
    queryKey: ["pr", "list", cwd, "all"],
    queryFn: () => ipc("pr.list", { cwd, filter: "all" }),
    staleTime: 30_000,
  });

  const prs = useMemo(() => {
    const all = [
      ...(reviewQuery.data ?? []),
      ...(authorQuery.data ?? []),
      ...(allQuery.data ?? []),
    ];
    return [...new Map(all.map((pr) => [pr.number, pr])).values()];
  }, [reviewQuery.data, authorQuery.data, allQuery.data]);

  // Build a lookup from cached enrichment data for size/label filters
  const enrichmentMap = useMemo(() => {
    const map = new Map<number, GhPrEnrichment>();
    for (const filter of ["reviewRequested", "authored", "all"]) {
      const cached = queryClient.getQueryData<GhPrEnrichment[]>(["pr", "enrichment", cwd, filter]);
      if (cached) {
        for (const e of cached) map.set(e.number, e);
      }
    }
    return map;
  }, [cwd, prs]); // re-derive when prs change (proxy for cache freshness)

  const visible = useMemo(() => {
    let filtered = prs.slice(0, 15);

    // ── Structured filters ──────────────────────────────────────────────

    // #N / pr:N — exact PR number
    if (filters.pr != null) {
      filtered = filtered.filter((p) => p.number === filters.pr);
    }

    // @name / author:name
    if (filters.author) {
      const a = filters.author.toLowerCase();
      filtered = filtered.filter((p) => p.author.login.toLowerCase().includes(a));
    }

    // branch:name
    if (filters.branch) {
      const b = filters.branch.toLowerCase();
      filtered = filtered.filter(
        (p) => p.headRefName.toLowerCase().includes(b) || p.baseRefName.toLowerCase().includes(b),
      );
    }

    // is: / state: / review: filters
    for (const flag of filters.is) {
      switch (flag) {
        case "draft":
          filtered = filtered.filter((p) => p.isDraft);
          break;
        case "open":
          filtered = filtered.filter((p) => p.state === "OPEN");
          break;
        case "merged":
          filtered = filtered.filter((p) => p.state === "MERGED");
          break;
        case "closed":
          filtered = filtered.filter((p) => p.state === "CLOSED");
          break;
        case "approved":
          filtered = filtered.filter((p) => p.reviewDecision === "APPROVED");
          break;
        case "changes-requested":
        case "changes":
          filtered = filtered.filter((p) => p.reviewDecision === "CHANGES_REQUESTED");
          break;
        case "review-required":
        case "pending":
          filtered = filtered.filter((p) => p.reviewDecision === "REVIEW_REQUIRED");
          break;
      }
    }

    // size:xs/s/m/l/xl (requires enrichment data)
    if (filters.size) {
      const target = filters.size as PrSize;
      filtered = filtered.filter((p) => {
        const e = enrichmentMap.get(p.number);
        if (!e) return false; // no enrichment yet — hide rather than guess
        return classifyPrSize(e.additions, e.deletions) === target;
      });
    }

    // ── Free-text search ────────────────────────────────────────────────
    if (filters.text) {
      filtered = filtered.filter((p) =>
        commandMatch(`${p.title} #${p.number} ${p.author.login}`, filters.text),
      );
    }

    return filtered;
  }, [prs, filters, enrichmentMap]);

  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Pull Requests</CommandGroupLabel>
      {visible.map((pr) => (
        <CommandItem
          key={pr.number}
          onSelect={() => {
            navigate({ view: "review", prNumber: pr.number });
            onSelect();
          }}
        >
          <PrStatusIcon pr={pr} />
          <span className="min-w-0 flex-1 truncate">{pr.title}</span>
          <span className="text-text-ghost shrink-0 font-mono text-[10px]">#{pr.number}</span>
          <span className="text-text-ghost shrink-0 text-[10px]">
            {formatAuthorName(pr.author, nameFormat)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function PrStatusIcon({ pr }: { pr: GhPrListItemCore }) {
  if (pr.isDraft) {
    return (
      <GitPullRequest
        size={14}
        className="text-text-ghost"
      />
    );
  }
  if (pr.reviewDecision === "APPROVED") {
    return (
      <Check
        size={14}
        className="text-success"
      />
    );
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return (
      <XCircle
        size={14}
        className="text-destructive"
      />
    );
  }
  return (
    <GitPullRequest
      size={14}
      className="text-purple"
    />
  );
}

// ---------------------------------------------------------------------------
// Files — jump to a file in the current PR diff
// ---------------------------------------------------------------------------

function FileGroup({ onSelect }: { onSelect: () => void }) {
  const filters = useCommandFilters();
  const { cwd } = useWorkspace();
  const { route } = useRouter();
  const fileNav = useFileNavSafe();

  const prNumber = route.view === "review" ? route.prNumber : null;

  const diffQuery = useQuery({
    queryKey: ["pr", "diff", cwd, prNumber],
    queryFn: () => ipc("pr.diff", { cwd, prNumber: prNumber! }),
    staleTime: 60_000,
    enabled: Boolean(prNumber),
  });

  const files = useMemo(() => {
    if (!diffQuery.data) return [];
    const paths: string[] = [];
    for (const line of diffQuery.data.split("\n")) {
      if (line.startsWith("+++ b/")) {
        paths.push(line.slice(6));
      }
    }
    return paths;
  }, [diffQuery.data]);

  const visible = useMemo(() => {
    let filtered = files;

    // file:/ext: filter — match extension or path segment
    if (filters.file) {
      const f = filters.file.toLowerCase();
      filtered = filtered.filter(
        (path) => path.toLowerCase().includes(f) || path.toLowerCase().endsWith(`.${f}`),
      );
    }

    // Free-text search
    if (filters.text) {
      filtered = filtered.filter((path) => commandMatch(path, filters.text));
    }

    return filtered;
  }, [files, filters]);

  if (!prNumber || visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Files in PR #{prNumber}</CommandGroupLabel>
      {visible.map((filePath) => {
        const originalIndex = files.indexOf(filePath);
        const fileName = filePath.split("/").pop() ?? filePath;
        const dirPath = filePath.includes("/")
          ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
          : "";
        return (
          <CommandItem
            key={filePath}
            onSelect={() => {
              if (fileNav) {
                fileNav.setCurrentFileIndex(originalIndex);
              }
              onSelect();
            }}
          >
            <FileCode size={14} />
            <span className="text-text-tertiary font-mono text-[10px]">{dirPath}</span>
            <span className="font-mono text-[11px]">{fileName}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

// Safe hook that doesn't throw if FileNavContext isn't available
function useFileNavSafe() {
  try {
    return useFileNav();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review actions — contextual actions for the current PR
// ---------------------------------------------------------------------------

function ReviewActionsGroup({ onSelect }: { onSelect: () => void }) {
  const filters = useCommandFilters();
  const { cwd } = useWorkspace();
  const { route } = useRouter();
  const repoSlug = useRepoSlug();

  const prNumber = route.view === "review" ? route.prNumber : null;
  if (!prNumber) return null;

  // PR-specific filters should NOT hide action commands
  // (e.g. `#3350` should still show actions for the current PR)
  // Only use free-text for filtering actions.
  const query = filters.text;

  const items = [
    {
      key: "approve",
      label: `Approve PR #${prNumber}`,
      shortcut: "a",
      icon: (
        <Check
          size={14}
          className="text-success"
        />
      ),
      action: () => {
        ipc("pr.submitReview", { cwd, prNumber, event: "APPROVE" }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["pr"] });
          toastManager.add({ title: "PR approved", type: "success" });
        });
        onSelect();
      },
    },
    {
      key: "open-github",
      label: `Open PR #${prNumber} on GitHub`,
      icon: <ExternalLink size={14} />,
      action: () => {
        void openExternal(`https://github.com/${repoSlug}/pull/${prNumber}`);
        onSelect();
      },
    },
    {
      key: "copy-url",
      label: "Copy PR URL",
      icon: <ClipboardCopy size={14} />,
      action: () => {
        navigator.clipboard.writeText(`https://github.com/${repoSlug}/pull/${prNumber}`);
        toastManager.add({ title: "PR URL copied", type: "success" });
        onSelect();
      },
    },
    {
      key: "copy-number",
      label: "Copy PR number",
      icon: <ClipboardCopy size={14} />,
      action: () => {
        navigator.clipboard.writeText(`#${prNumber}`);
        toastManager.add({ title: "Copied #" + prNumber, type: "success" });
        onSelect();
      },
    },
    {
      key: "toggle-panel",
      label: "Toggle side panel",
      shortcut: "i",
      icon: <PanelRight size={14} />,
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
        onSelect();
      },
    },
    {
      key: "next-unreviewed",
      label: "Jump to next unreviewed file",
      shortcut: "n",
      icon: <Eye size={14} />,
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((i) => commandMatch(i.label, query)) : items;
  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Review Actions</CommandGroupLabel>
      {visible.map((item) => (
        <CommandItem
          key={item.key}
          onSelect={item.action}
        >
          {item.icon}
          {item.label}
          {"shortcut" in item && item.shortcut && (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function NavigationGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const { navigate } = useRouter();

  const items = [
    {
      key: "review",
      label: "Go to Review",
      shortcut: "1",
      icon: <GitPullRequest size={14} />,
      action: () => {
        navigate({ view: "review", prNumber: null });
        onSelect();
      },
    },
    {
      key: "workflows",
      label: "Go to Workflows",
      shortcut: "2",
      icon: <Zap size={14} />,
      action: () => {
        navigate({ view: "workflows" });
        onSelect();
      },
    },
    {
      key: "metrics",
      label: "Go to Metrics",
      shortcut: "3",
      icon: <BarChart3 size={14} />,
      action: () => {
        navigate({ view: "metrics" });
        onSelect();
      },
    },
    {
      key: "releases",
      label: "Go to Releases",
      shortcut: "4",
      icon: <Tag size={14} />,
      action: () => {
        navigate({ view: "releases" });
        onSelect();
      },
    },
    {
      key: "settings",
      label: "Open Settings",
      icon: <Settings size={14} />,
      action: () => {
        navigate({ view: "settings" });
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((i) => commandMatch(i.label, query)) : items;
  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Navigation</CommandGroupLabel>
      {visible.map((item) => (
        <CommandItem
          key={item.key}
          onSelect={item.action}
        >
          {item.icon}
          {item.label}
          {"shortcut" in item && item.shortcut && (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Workspaces — switch between repos
// ---------------------------------------------------------------------------

function WorkspaceGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const { cwd, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();

  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });
  const workspaces = workspacesQuery.data ?? [];

  const addRepoLabel = "Add repository";
  const visibleWorkspaces = query
    ? workspaces.filter((ws) => commandMatch(`${ws.name} ${ws.path}`, query))
    : workspaces;
  const showAddRepo = commandMatch(addRepoLabel, query);

  if (visibleWorkspaces.length === 0 && !showAddRepo) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Workspaces</CommandGroupLabel>
      {visibleWorkspaces.map((ws) => (
        <CommandItem
          key={ws.id}
          onSelect={() => {
            ipc("workspace.setActive", { path: ws.path }).then(() => {
              switchWorkspace(ws.path);
              queryClient.invalidateQueries();
              navigate({ view: "review", prNumber: null });
            });
            onSelect();
          }}
        >
          <GitBranch
            size={14}
            className={ws.path === cwd ? "text-primary" : ""}
          />
          <span className={ws.path === cwd ? "font-medium" : ""}>{ws.name}</span>
          {ws.path === cwd && <span className="text-text-ghost text-[10px]">current</span>}
          <span className="text-text-ghost ml-auto truncate font-mono text-[10px]">{ws.path}</span>
        </CommandItem>
      ))}
      {showAddRepo && (
        <CommandItem
          onSelect={() => {
            ipc("workspace.pickFolder").then((result) => {
              if (result) {
                ipc("workspace.add", { path: result }).then(() => {
                  ipc("workspace.setActive", { path: result }).then(() => {
                    switchWorkspace(result);
                    queryClient.invalidateQueries();
                    navigate({ view: "review", prNumber: null });
                  });
                });
              }
            });
            onSelect();
          }}
        >
          <FolderOpen size={14} />
          {addRepoLabel}...
        </CommandItem>
      )}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Workflows — trigger or view recent workflow runs
// ---------------------------------------------------------------------------

function WorkflowGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();

  const workflowsQuery = useQuery({
    queryKey: ["workflows", "list", cwd],
    queryFn: () => ipc("workflows.list", { cwd }),
    staleTime: 60_000,
  });
  const workflows = (workflowsQuery.data ?? []).filter((w) => w.state === "active");

  const visible = useMemo(() => {
    if (!query) return workflows;
    return workflows.filter((wf) => commandMatch(wf.name, query));
  }, [workflows, query]);

  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Workflows</CommandGroupLabel>
      {visible.map((wf) => (
        <CommandItem
          key={wf.id}
          onSelect={() => {
            navigate({ view: "workflows" });
            onSelect();
          }}
        >
          <Play size={14} />
          {wf.name}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Git actions
// ---------------------------------------------------------------------------

function GitGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const repoSlug = useRepoSlug();

  const items = [
    {
      key: "open-repo",
      label: "Open repo on GitHub",
      icon: <ExternalLink size={14} />,
      action: () => {
        void openExternal(`https://github.com/${repoSlug}`);
        onSelect();
      },
    },
    {
      key: "view-prs",
      label: "View all PRs on GitHub",
      icon: <GitPullRequest size={14} />,
      action: () => {
        void openExternal(`https://github.com/${repoSlug}/pulls`);
        onSelect();
      },
    },
    {
      key: "view-actions",
      label: "View Actions on GitHub",
      icon: <Zap size={14} />,
      action: () => {
        void openExternal(`https://github.com/${repoSlug}/actions`);
        onSelect();
      },
    },
    {
      key: "copy-slug",
      label: "Copy repo slug",
      icon: <ClipboardCopy size={14} />,
      action: () => {
        navigator.clipboard.writeText(repoSlug);
        toastManager.add({ title: "Repo slug copied", type: "success" });
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((i) => commandMatch(i.label, query)) : items;
  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Git</CommandGroupLabel>
      {visible.map((item) => (
        <CommandItem
          key={item.key}
          onSelect={item.action}
        >
          {item.icon}
          {item.label}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// System commands
// ---------------------------------------------------------------------------

function SystemGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();

  const items = [
    {
      key: "refresh",
      label: "Refresh all data",
      icon: <RefreshCw size={14} />,
      action: () => {
        queryClient.invalidateQueries();
        toastManager.add({ title: "Refreshing all data...", type: "success" });
        onSelect();
      },
    },
    {
      key: "clear-cache",
      label: "Clear cache and refresh",
      icon: <RotateCcw size={14} />,
      action: () => {
        queryClient.clear();
        queryClient.invalidateQueries();
        toastManager.add({ title: "Cache cleared", type: "success" });
        onSelect();
      },
    },
    {
      key: "toggle-sidebar",
      label: "Toggle sidebar",
      shortcut: "⌘B",
      icon: <Layers size={14} />,
      action: () => {
        globalThis.dispatchEvent(
          new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }),
        );
        onSelect();
      },
    },
    {
      key: "keyboard-shortcuts",
      label: "Show keyboard shortcuts",
      shortcut: "?",
      icon: <Keyboard size={14} />,
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
        onSelect();
      },
    },
    {
      key: "focus-search",
      label: "Focus PR search",
      shortcut: "/",
      icon: <Search size={14} />,
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
        onSelect();
      },
    },
    {
      key: "manage-tokens",
      label: "Manage GitHub tokens",
      icon: <BookOpen size={14} />,
      action: () => {
        void openExternal("https://github.com/settings/tokens");
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((i) => commandMatch(i.label, query)) : items;
  if (visible.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>System</CommandGroupLabel>
      {visible.map((item) => (
        <CommandItem
          key={item.key}
          onSelect={item.action}
        >
          {item.icon}
          {item.label}
          {"shortcut" in item && item.shortcut && (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
