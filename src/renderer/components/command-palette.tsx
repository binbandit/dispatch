import type { GhPrListItemCore } from "@/shared/ipc";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
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

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { useFileNav } from "../lib/file-nav-context";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Command palette — ⌘K global search and action launcher.
 *
 * A power-user command center that surfaces every action in Dispatch.
 * Fuzzy-searchable across navigation, PRs, files, workspaces, git actions,
 * workflows, and system commands.
 */

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts([
    { key: "k", modifiers: ["meta"], handler: () => setOpen(true) },
    { key: "p", modifiers: ["meta", "shift"], handler: () => setOpen(true) },
  ]);

  const close = () => setOpen(false);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
    >
      <CommandDialogPopup>
        <Command>
          <CommandInput placeholder="Type a command or search..." />
          <CommandPanel>
            <CommandList>
              <CommandEmpty>
                <div className="text-text-tertiary py-6 text-center text-sm">No results found.</div>
              </CommandEmpty>

              <PullRequestGroup onSelect={close} />
              <CommandSeparator />
              <FileGroup onSelect={close} />
              <CommandSeparator />
              <ReviewActionsGroup onSelect={close} />
              <CommandSeparator />
              <NavigationGroup onSelect={close} />
              <CommandSeparator />
              <WorkspaceGroup onSelect={close} />
              <CommandSeparator />
              <WorkflowGroup onSelect={close} />
              <CommandSeparator />
              <GitGroup onSelect={close} />
              <CommandSeparator />
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
// Pull Requests — quick jump to any open PR
// ---------------------------------------------------------------------------

function PullRequestGroup({ onSelect }: { onSelect: () => void }) {
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();

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

  if (prs.length === 0) {
    return null;
  }

  return (
    <CommandGroup>
      <CommandGroupLabel>Pull Requests</CommandGroupLabel>
      {prs.slice(0, 15).map((pr) => (
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
          <span className="text-text-ghost shrink-0 text-[10px]">{pr.author.login}</span>
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
    // Simple extraction of file paths from diff headers
    const paths: string[] = [];
    for (const line of diffQuery.data.split("\n")) {
      if (line.startsWith("+++ b/")) {
        paths.push(line.slice(6));
      }
    }
    return paths;
  }, [diffQuery.data]);

  if (!prNumber || files.length === 0) {
    return null;
  }

  return (
    <CommandGroup>
      <CommandGroupLabel>Files in PR #{prNumber}</CommandGroupLabel>
      {files.map((filePath, i) => {
        const fileName = filePath.split("/").pop() ?? filePath;
        const dirPath = filePath.includes("/")
          ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
          : "";
        return (
          <CommandItem
            key={filePath}
            onSelect={() => {
              if (fileNav) {
                fileNav.setCurrentFileIndex(i);
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
  const { cwd } = useWorkspace();
  const { route } = useRouter();

  const prNumber = route.view === "review" ? route.prNumber : null;
  if (!prNumber) return null;

  const repoSlug = cwd.split("/").slice(-2).join("/");

  return (
    <CommandGroup>
      <CommandGroupLabel>Review Actions</CommandGroupLabel>
      <CommandItem
        onSelect={() => {
          ipc("pr.submitReview", { cwd, prNumber, event: "APPROVE" }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["pr"] });
            toastManager.add({ title: "PR approved", type: "success" });
          });
          onSelect();
        }}
      >
        <Check
          size={14}
          className="text-success"
        />
        Approve PR #{prNumber}
        <CommandShortcut>a</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          void openExternal(`https://github.com/${repoSlug}/pull/${prNumber}`);
          onSelect();
        }}
      >
        <ExternalLink size={14} />
        Open PR #{prNumber} on GitHub
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigator.clipboard.writeText(`https://github.com/${repoSlug}/pull/${prNumber}`);
          toastManager.add({ title: "PR URL copied", type: "success" });
          onSelect();
        }}
      >
        <ClipboardCopy size={14} />
        Copy PR URL
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigator.clipboard.writeText(`#${prNumber}`);
          toastManager.add({ title: "Copied #" + prNumber, type: "success" });
          onSelect();
        }}
      >
        <ClipboardCopy size={14} />
        Copy PR number
      </CommandItem>
      <CommandItem
        onSelect={() => {
          // Toggle the side panel via keyboard shortcut
          globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
          onSelect();
        }}
      >
        <PanelRight size={14} />
        Toggle side panel
        <CommandShortcut>i</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
          onSelect();
        }}
      >
        <Eye size={14} />
        Jump to next unreviewed file
        <CommandShortcut>n</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function NavigationGroup({ onSelect }: { onSelect: () => void }) {
  const { navigate } = useRouter();

  return (
    <CommandGroup>
      <CommandGroupLabel>Navigation</CommandGroupLabel>
      <CommandItem
        onSelect={() => {
          navigate({ view: "review", prNumber: null });
          onSelect();
        }}
      >
        <GitPullRequest size={14} />
        Go to Review
        <CommandShortcut>1</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigate({ view: "workflows" });
          onSelect();
        }}
      >
        <Zap size={14} />
        Go to Workflows
        <CommandShortcut>2</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigate({ view: "metrics" });
          onSelect();
        }}
      >
        <BarChart3 size={14} />
        Go to Metrics
        <CommandShortcut>3</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigate({ view: "releases" });
          onSelect();
        }}
      >
        <Tag size={14} />
        Go to Releases
        <CommandShortcut>4</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          navigate({ view: "settings" });
          onSelect();
        }}
      >
        <Settings size={14} />
        Open Settings
      </CommandItem>
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Workspaces — switch between repos
// ---------------------------------------------------------------------------

function WorkspaceGroup({ onSelect }: { onSelect: () => void }) {
  const { cwd, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();

  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });
  const workspaces = workspacesQuery.data ?? [];

  return (
    <CommandGroup>
      <CommandGroupLabel>Workspaces</CommandGroupLabel>
      {workspaces.map((ws) => (
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
        Add repository...
      </CommandItem>
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Workflows — trigger or view recent workflow runs
// ---------------------------------------------------------------------------

function WorkflowGroup({ onSelect }: { onSelect: () => void }) {
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();

  const workflowsQuery = useQuery({
    queryKey: ["workflows", "list", cwd],
    queryFn: () => ipc("workflows.list", { cwd }),
    staleTime: 60_000,
  });
  const workflows = (workflowsQuery.data ?? []).filter((w) => w.state === "active");

  if (workflows.length === 0) return null;

  return (
    <CommandGroup>
      <CommandGroupLabel>Workflows</CommandGroupLabel>
      {workflows.map((wf) => (
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
  const { cwd } = useWorkspace();

  return (
    <CommandGroup>
      <CommandGroupLabel>Git</CommandGroupLabel>
      <CommandItem
        onSelect={() => {
          void openExternal(`https://github.com/${cwd.split("/").slice(-2).join("/")}`);
          onSelect();
        }}
      >
        <ExternalLink size={14} />
        Open repo on GitHub
      </CommandItem>
      <CommandItem
        onSelect={() => {
          const repoSlug = cwd.split("/").slice(-2).join("/");
          void openExternal(`https://github.com/${repoSlug}/pulls`);
          onSelect();
        }}
      >
        <GitPullRequest size={14} />
        View all PRs on GitHub
      </CommandItem>
      <CommandItem
        onSelect={() => {
          const repoSlug = cwd.split("/").slice(-2).join("/");
          void openExternal(`https://github.com/${repoSlug}/actions`);
          onSelect();
        }}
      >
        <Zap size={14} />
        View Actions on GitHub
      </CommandItem>
      <CommandItem
        onSelect={() => {
          const repoSlug = cwd.split("/").slice(-2).join("/");
          navigator.clipboard.writeText(repoSlug);
          toastManager.add({ title: "Repo slug copied", type: "success" });
          onSelect();
        }}
      >
        <ClipboardCopy size={14} />
        Copy repo slug
      </CommandItem>
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// System commands
// ---------------------------------------------------------------------------

function SystemGroup({ onSelect }: { onSelect: () => void }) {
  return (
    <CommandGroup>
      <CommandGroupLabel>System</CommandGroupLabel>
      <CommandItem
        onSelect={() => {
          queryClient.invalidateQueries();
          toastManager.add({ title: "Refreshing all data...", type: "success" });
          onSelect();
        }}
      >
        <RefreshCw size={14} />
        Refresh all data
      </CommandItem>
      <CommandItem
        onSelect={() => {
          queryClient.clear();
          queryClient.invalidateQueries();
          toastManager.add({ title: "Cache cleared", type: "success" });
          onSelect();
        }}
      >
        <RotateCcw size={14} />
        Clear cache and refresh
      </CommandItem>
      <CommandItem
        onSelect={() => {
          globalThis.dispatchEvent(
            new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }),
          );
          onSelect();
        }}
      >
        <Layers size={14} />
        Toggle sidebar
        <CommandShortcut>⌘B</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
          onSelect();
        }}
      >
        <Keyboard size={14} />
        Show keyboard shortcuts
        <CommandShortcut>?</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
          onSelect();
        }}
      >
        <Search size={14} />
        Focus PR search
        <CommandShortcut>/</CommandShortcut>
      </CommandItem>
      <CommandItem
        onSelect={() => {
          void openExternal("https://github.com/settings/tokens");
          onSelect();
        }}
      >
        <BookOpen size={14} />
        Manage GitHub tokens
      </CommandItem>
    </CommandGroup>
  );
}
