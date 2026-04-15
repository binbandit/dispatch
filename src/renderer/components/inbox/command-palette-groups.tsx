/* eslint-disable import/max-dependencies -- The command palette groups intentionally gather cross-cutting command sources in one place. */
import type { GhPrListItemCore } from "@/shared/ipc";

import {
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandShortcut,
  commandMatch,
  useCommandFilters,
  useCommandQuery,
} from "@/components/ui/command";
import { toastManager } from "@/components/ui/toast";
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
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useFileNavStore } from "@/renderer/lib/review/file-nav-context";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  ClipboardCopy,
  ExternalLink,
  FileCode,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Settings,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

type PrSize = "xs" | "s" | "m" | "l" | "xl";

/** Resolve the real GitHub `owner/repo` slug from the git remote. */
function useRepoSlug(): string {
  const { nwo, repoTarget } = useWorkspace();
  const repoInfo = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
    staleTime: 300_000,
  });
  return repoInfo.data?.nameWithOwner ?? "";
}

function classifyPrSize(additions: number, deletions: number): PrSize {
  const total = additions + deletions;
  if (total < 10) {
    return "xs";
  }
  if (total < 50) {
    return "s";
  }
  if (total < 200) {
    return "m";
  }
  if (total < 500) {
    return "l";
  }
  return "xl";
}

function matchesPrAuthor(pr: GhPrListItemCore, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  return (
    pr.author.login.toLowerCase().includes(normalizedQuery) ||
    (pr.author.name?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

// ---------------------------------------------------------------------------
// Pull Requests — search/jump to any PR
// ---------------------------------------------------------------------------

export function PullRequestGroup({ onSelect }: { onSelect: () => void }) {
  const rawQuery = useCommandQuery();
  const filters = useCommandFilters();
  const { nwo, repoTarget } = useWorkspace();
  const { navigate } = useRouter();
  const nameFormat = useDisplayNameFormat();

  const reviewQuery = useQuery({
    queryKey: ["pr", "list", nwo, "reviewRequested"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "reviewRequested" }),
    staleTime: 30_000,
  });
  const authorQuery = useQuery({
    queryKey: ["pr", "list", nwo, "authored"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "authored" }),
    staleTime: 30_000,
  });
  const allQuery = useQuery({
    queryKey: ["pr", "list", nwo, "all", "all"],
    queryFn: () => ipc("pr.list", { ...repoTarget, filter: "all", state: "all" }),
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

  const visible = useMemo(() => {
    let filtered = prs;

    if (filters.pr !== null && filters.pr !== undefined) {
      filtered = filtered.filter((pr) => pr.number === filters.pr);
    }

    const authorFilter = filters.author;
    if (authorFilter) {
      filtered = filtered.filter((pr) => matchesPrAuthor(pr, authorFilter));
    }

    if (filters.branch) {
      const branch = filters.branch.toLowerCase();
      filtered = filtered.filter(
        (pr) =>
          pr.headRefName.toLowerCase().includes(branch) ||
          pr.baseRefName.toLowerCase().includes(branch),
      );
    }

    for (const flag of filters.is) {
      switch (flag) {
        case "draft": {
          filtered = filtered.filter((pr) => pr.isDraft);
          break;
        }
        case "open": {
          filtered = filtered.filter((pr) => pr.state === "OPEN");
          break;
        }
        case "merged": {
          filtered = filtered.filter((pr) => pr.state === "MERGED");
          break;
        }
        case "closed": {
          filtered = filtered.filter((pr) => pr.state === "CLOSED");
          break;
        }
        case "approved": {
          filtered = filtered.filter((pr) => pr.reviewDecision === "APPROVED");
          break;
        }
        case "changes-requested":
        case "changes": {
          filtered = filtered.filter((pr) => pr.reviewDecision === "CHANGES_REQUESTED");
          break;
        }
        case "review-required":
        case "pending": {
          filtered = filtered.filter((pr) => pr.reviewDecision === "REVIEW_REQUIRED");
          break;
        }
      }
    }

    if (filters.size) {
      const target = filters.size as PrSize;
      filtered = filtered.filter((pr) => classifyPrSize(pr.additions, pr.deletions) === target);
    }

    if (filters.text) {
      filtered = filtered.filter((pr) =>
        commandMatch(
          `${pr.title} #${pr.number} ${pr.author.login} ${pr.author.name ?? ""}`,
          filters.text,
        ),
      );
    }

    return filtered.slice(0, 15);
  }, [filters, prs]);

  const searchRefreshRequests = useMemo<PrSearchRefreshRequest[]>(() => {
    const baseRequests: PrSearchRefreshRequest[] = [
      {
        method: "pr.list",
        args: { ...repoTarget, filter: "reviewRequested", state: "open" },
        queryKey: ["pr", "list", nwo, "reviewRequested"],
      },
      {
        method: "pr.list",
        args: { ...repoTarget, filter: "authored", state: "open" },
        queryKey: ["pr", "list", nwo, "authored"],
      },
      {
        method: "pr.list",
        args: { ...repoTarget, filter: "all", state: "all" },
        queryKey: ["pr", "list", nwo, "all", "all"],
      },
    ];
    return baseRequests;
  }, [nwo, repoTarget]);

  usePrSearchRefreshOnMiss({
    scope: `command-palette:${nwo}`,
    searchQuery: rawQuery,
    resultCount: visible.length,
    requests: searchRefreshRequests,
  });

  if (visible.length === 0) {
    return null;
  }

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

export function PrStatusIcon({ pr }: { pr: GhPrListItemCore }) {
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

export function FileGroup({ onSelect }: { onSelect: () => void }) {
  const filters = useCommandFilters();
  const { nwo, repoTarget } = useWorkspace();
  const { route } = useRouter();
  const fileNav = useFileNavSafe();

  const prNumber = route.view === "review" ? route.prNumber : null;

  const diffQuery = useQuery({
    queryKey: ["pr", "diff", nwo, prNumber],
    queryFn: () =>
      prNumber === null ? Promise.resolve("") : ipc("pr.diff", { ...repoTarget, prNumber }),
    staleTime: 60_000,
    enabled: Boolean(prNumber),
  });

  const files = useMemo(() => {
    if (!diffQuery.data) {
      return [];
    }

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

    if (filters.file) {
      const fileFilter = filters.file.toLowerCase();
      filtered = filtered.filter(
        (path) =>
          path.toLowerCase().includes(fileFilter) || path.toLowerCase().endsWith(`.${fileFilter}`),
      );
    }

    if (filters.text) {
      filtered = filtered.filter((path) => commandMatch(path, filters.text));
    }

    return filtered;
  }, [files, filters]);

  if (!prNumber || visible.length === 0) {
    return null;
  }

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
                fileNav.setCurrentFilePath(filePath);
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

function useFileNavSafe() {
  // Only select the actions needed — avoids re-rendering on unrelated state changes
  const setCurrentFileIndex = useFileNavStore((s) => s.setCurrentFileIndex);
  const setCurrentFilePath = useFileNavStore((s) => s.setCurrentFilePath);
  return { setCurrentFileIndex, setCurrentFilePath };
}

// ---------------------------------------------------------------------------
// Review Actions — actions for the PR you're currently reviewing
// ---------------------------------------------------------------------------

export function ReviewActionsGroup({ onSelect }: { onSelect: () => void }) {
  const filters = useCommandFilters();
  const { nwo, repoTarget } = useWorkspace();
  const { route } = useRouter();
  const repoSlug = useRepoSlug();

  const prNumber = route.view === "review" ? route.prNumber : null;
  if (!prNumber) {
    return null;
  }

  // Fetch PR detail for branch name and check status
  const detailQuery = useQuery({
    queryKey: ["pr", "detail", nwo, prNumber],
    queryFn: () => ipc("pr.detail", { ...repoTarget, prNumber }),
    staleTime: 30_000,
  });
  const pr = detailQuery.data;

  const query = filters.text;

  const items: {
    key: string;
    label: string;
    icon: React.ReactNode;
    shortcut?: string;
    action: () => void;
  }[] = [
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
        ipc("pr.submitReview", { ...repoTarget, prNumber, event: "APPROVE" }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["pr"] });
          toastManager.add({ title: "PR approved", type: "success" });
        });
        onSelect();
      },
    },
    {
      key: "request-changes",
      label: "Request changes",
      shortcut: "r",
      icon: <MessageSquare size={14} />,
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
        onSelect();
      },
    },
    {
      key: "merge",
      label: `Merge PR #${prNumber}`,
      shortcut: "m",
      icon: (
        <GitMerge
          size={14}
          className="text-purple"
        />
      ),
      action: () => {
        globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
        onSelect();
      },
    },
    {
      key: "copy-branch",
      label: "Copy branch name",
      icon: <ClipboardCopy size={14} />,
      action: () => {
        const branchName = pr?.headRefName ?? "";
        if (branchName) {
          navigator.clipboard.writeText(branchName);
          toastManager.add({ title: `Copied ${branchName}`, type: "success" });
        }
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
      key: "open-github",
      label: `Open on GitHub`,
      icon: <ExternalLink size={14} />,
      action: () => {
        void openExternal(`https://github.com/${repoSlug}/pull/${prNumber}`);
        onSelect();
      },
    },
    {
      key: "mark-all-viewed",
      label: "Mark all files as viewed",
      icon: <CheckCheck size={14} />,
      action: () => {
        ipc("pr.diff", { ...repoTarget, prNumber }).then((diff) => {
          const paths: string[] = [];
          for (const line of diff.split("\n")) {
            if (line.startsWith("+++ b/")) {
              paths.push(line.slice(6));
            }
          }
          if (paths.length > 0) {
            ipc("review.setFilesViewed", {
              repo: nwo,
              prNumber,
              filePaths: paths,
              viewed: true,
            }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["review", "viewedFiles"] });
              toastManager.add({
                title: `Marked ${paths.length} files as viewed`,
                type: "success",
              });
            });
          }
        });
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((item) => commandMatch(item.label, query)) : items;
  if (visible.length === 0) {
    return null;
  }

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
          {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

// ---------------------------------------------------------------------------
// Workspaces — switch repo context
// ---------------------------------------------------------------------------

export function WorkspaceGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const { nwo, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();

  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });
  const workspaces = workspacesQuery.data ?? [];

  const addRepoLabel = "Add repository";
  const visibleWorkspaces = query
    ? workspaces.filter((workspace) => commandMatch(`${workspace.name} ${workspace.path}`, query))
    : workspaces;
  const showAddRepo = commandMatch(addRepoLabel, query);

  if (visibleWorkspaces.length === 0 && !showAddRepo) {
    return null;
  }

  return (
    <CommandGroup>
      <CommandGroupLabel>Workspaces</CommandGroupLabel>
      {visibleWorkspaces.map((workspace) => (
        <CommandItem
          key={workspace.id}
          onSelect={() => {
            switchWorkspace({
              id: workspace.id,
              owner: workspace.owner,
              repo: workspace.repo,
              path: workspace.path,
            });
            queryClient.invalidateQueries();
            navigate({ view: "review", prNumber: null });
            onSelect();
          }}
        >
          <GitBranch
            size={14}
            className={`${workspace.owner}/${workspace.repo}` === nwo ? "text-primary" : ""}
          />
          <span className={`${workspace.owner}/${workspace.repo}` === nwo ? "font-medium" : ""}>
            {workspace.name}
          </span>
          {`${workspace.owner}/${workspace.repo}` === nwo && (
            <span className="text-text-ghost text-[10px]">current</span>
          )}
          <span className="text-text-ghost ml-auto truncate font-mono text-[10px]">
            {workspace.path}
          </span>
        </CommandItem>
      ))}
      {showAddRepo && (
        <CommandItem
          onSelect={() => {
            ipc("workspace.pickFolder").then((result) => {
              if (result) {
                ipc("workspace.addFromFolder", { path: result }).then((ws) => {
                  ipc("workspace.list").then((list) => {
                    const added = list.find((w) => w.owner === ws.owner && w.repo === ws.repo);
                    if (added) {
                      switchWorkspace({
                        id: added.id,
                        owner: added.owner,
                        repo: added.repo,
                        path: added.path,
                      });
                    }
                  });
                  queryClient.invalidateQueries();
                  navigate({ view: "review", prNumber: null });
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
// General actions — things you reach for regardless of context
// ---------------------------------------------------------------------------

export function ActionsGroup({ onSelect }: { onSelect: () => void }) {
  const { text: query } = useCommandFilters();
  const { navigate } = useRouter();
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
      key: "refresh",
      label: "Refresh all data",
      icon: <RefreshCw size={14} />,
      action: () => {
        queryClient.invalidateQueries();
        toastManager.add({ title: "Refreshing…", type: "success" });
        onSelect();
      },
    },
    {
      key: "settings",
      label: "Open Settings",
      shortcut: "⌘,",
      icon: <Settings size={14} />,
      action: () => {
        navigate({ view: "settings" });
        onSelect();
      },
    },
  ];

  const visible = query ? items.filter((item) => commandMatch(item.label, query)) : items;
  if (visible.length === 0) {
    return null;
  }

  return (
    <CommandGroup>
      <CommandGroupLabel>Actions</CommandGroupLabel>
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
