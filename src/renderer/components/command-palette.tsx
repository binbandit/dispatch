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
  ExternalLink,
  FileCode,
  GitPullRequest,
  Keyboard,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { ipc } from "../lib/ipc";
import { openExternal } from "../lib/open-external";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";

/**
 * Command palette — ⌘K global search and action launcher.
 *
 * Groups:
 * - Navigation: switch between views
 * - Pull Requests: jump to a specific PR
 * - Actions: refresh, open in browser, workspace management
 */

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts([
    {
      key: "k",
      modifiers: ["meta"],
      handler: () => setOpen(true),
    },
  ]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
    >
      <CommandDialogPopup>
        <Command>
          <CommandInput placeholder="Search commands, PRs, actions..." />
          <CommandPanel>
            <CommandList>
              <CommandEmpty>
                <div className="text-text-tertiary py-6 text-center text-sm">No results found.</div>
              </CommandEmpty>

              <NavigationGroup onSelect={() => setOpen(false)} />
              <CommandSeparator />
              <PullRequestGroup onSelect={() => setOpen(false)} />
              <CommandSeparator />
              <ActionsGroup onSelect={() => setOpen(false)} />
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
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------
// Navigation group
// ---------------------------------------------------------------------------

function NavigationGroup({ onSelect }: { onSelect: () => void }) {
  const { navigate } = useRouter();

  const items = [
    {
      label: "Go to Review",
      icon: GitPullRequest,
      shortcut: "1",
      action: () => navigate({ view: "review", prNumber: null }),
    },
    {
      label: "Go to Workflows",
      icon: Zap,
      shortcut: "2",
      action: () => navigate({ view: "workflows" }),
    },
    {
      label: "Go to Metrics",
      icon: BarChart3,
      shortcut: "3",
      action: () => navigate({ view: "metrics" }),
    },
    {
      label: "Go to Releases",
      icon: Tag,
      shortcut: "4",
      action: () => navigate({ view: "releases" }),
    },
    {
      label: "Open Settings",
      icon: Settings,
      shortcut: "⌘,",
      action: () => navigate({ view: "settings" }),
    },
  ];

  return (
    <CommandGroup>
      <CommandGroupLabel>Navigation</CommandGroupLabel>
      {items.map((item) => (
        <CommandItem
          key={item.label}
          onSelect={() => {
            item.action();
            onSelect();
          }}
        >
          <item.icon size={14} />
          {item.label}
          <CommandShortcut>{item.shortcut}</CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Pull Requests group — shows review-requested PRs for quick jump
// ---------------------------------------------------------------------------

function PullRequestGroup({ onSelect }: { onSelect: () => void }) {
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();

  const prQuery = useQuery({
    queryKey: ["pr", "list", cwd, "reviewRequested"],
    queryFn: () => ipc("pr.list", { cwd, filter: "reviewRequested" }),
    staleTime: 30_000,
  });

  const authorQuery = useQuery({
    queryKey: ["pr", "list", cwd, "authored"],
    queryFn: () => ipc("pr.list", { cwd, filter: "authored" }),
    staleTime: 30_000,
  });

  const prs = [...(prQuery.data ?? []), ...(authorQuery.data ?? [])];
  // Dedupe by number
  const unique = [...new Map(prs.map((pr) => [pr.number, pr])).values()];

  if (unique.length === 0) {
    return null;
  }

  return (
    <CommandGroup>
      <CommandGroupLabel>Pull Requests</CommandGroupLabel>
      {unique.slice(0, 10).map((pr) => (
        <CommandItem
          key={pr.number}
          onSelect={() => {
            navigate({ view: "review", prNumber: pr.number });
            onSelect();
          }}
        >
          <GitPullRequest size={14} />
          <span className="min-w-0 flex-1 truncate">{pr.title}</span>
          <span className="text-text-ghost font-mono text-[10px]">#{pr.number}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Actions group
// ---------------------------------------------------------------------------

function ActionsGroup({ onSelect }: { onSelect: () => void }) {
  const { cwd } = useWorkspace();
  const { route } = useRouter();

  const selectedPr = route.view === "review" ? route.prNumber : null;

  const actions = [
    {
      label: "Refresh all data",
      icon: RefreshCw,
      action: () => {
        queryClient.invalidateQueries();
        toastManager.add({ title: "Refreshing...", type: "success" });
      },
    },
    {
      label: "Open repo on GitHub",
      icon: ExternalLink,
      action: () => {
        const repoSlug = cwd.split("/").slice(-2).join("/");
        void openExternal(`https://github.com/${repoSlug}`);
      },
    },
    ...(selectedPr
      ? [
          {
            label: `Open PR #${selectedPr} on GitHub`,
            icon: ExternalLink,
            action: () => {
              const repoSlug = cwd.split("/").slice(-2).join("/");
              void openExternal(`https://github.com/${repoSlug}/pull/${selectedPr}`);
            },
          },
        ]
      : []),
    {
      label: "Toggle sidebar",
      icon: FileCode,
      shortcut: "⌘B",
      action: () => {
        // Dispatch a keyboard event to toggle sidebar
        globalThis.dispatchEvent(
          new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }),
        );
      },
    },
    {
      label: "Show keyboard shortcuts",
      icon: Keyboard,
      shortcut: "?",
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
      },
    },
    {
      label: "Search pull requests",
      icon: Search,
      shortcut: "/",
      action: () => {
        // Focus the search input in the PR inbox
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
      },
    },
  ];

  return (
    <CommandGroup>
      <CommandGroupLabel>Actions</CommandGroupLabel>
      {actions.map((item) => (
        <CommandItem
          key={item.label}
          onSelect={() => {
            item.action();
            onSelect();
          }}
        >
          <item.icon size={14} />
          {item.label}
          {"shortcut" in item && item.shortcut && (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
