/* eslint-disable import/max-dependencies -- Navbar intentionally composes app-level chrome controls. */
import type { GhAccount } from "@/shared/ipc";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AddRepoDialog } from "@/renderer/components/shared/add-repo-dialog";
import { DispatchLogo } from "@/renderer/components/shared/dispatch-logo";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { resizeGitHubAvatarUrl } from "@/renderer/lib/shared/github-avatar";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Check,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  LogOut,
  Plus,
  Tag,
  RefreshCw,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { NotificationCenter } from "./notification-center";

/**
 * Navbar — DISPATCH-DESIGN-SYSTEM.md § 8.1
 *
 * Route-aware tabs: Review | Workflows
 * Workspace switcher + user menu in the right area
 */
export function Navbar({
  bannerVisible,
  isFullscreen,
}: {
  bannerVisible?: boolean;
  isFullscreen: boolean;
}) {
  const isMac = globalThis.navigator?.platform?.includes("Mac") ?? false;
  const { route, navigate, toggleSettings } = useRouter();
  const collapseNavLabels = useMediaQuery({ max: 1100 });
  const collapseChromeLabels = useMediaQuery({ max: 940 });

  // Fetch authenticated GitHub user for avatar
  const userQuery = useQuery({
    queryKey: ["env", "user"],
    queryFn: () => ipc("env.user"),
    staleTime: 300_000,
    retry: 1,
  });
  const user = userQuery.data ?? null;

  return (
    <header
      className="border-border bg-bg-surface flex h-10 shrink-0 items-center overflow-hidden border-b pr-3"
      style={
        {
          WebkitAppRegion: "drag",
          paddingLeft: isMac && !isFullscreen && !bannerVisible ? 92 : 16,
        } as React.CSSProperties
      }
    >
      {/* Logo */}
      <button
        type="button"
        className="flex shrink-0 cursor-pointer items-center gap-[7px] transition-opacity hover:opacity-80"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-label="Dispatch"
        title={collapseChromeLabels ? "Dispatch" : undefined}
        onClick={() => navigate({ view: "review", prNumber: null })}
      >
        <DispatchLogo size={20} />
        {!collapseChromeLabels && (
          <span className="text-text-primary text-[13px] font-semibold tracking-[-0.02em]">
            Dispatch
          </span>
        )}
      </button>

      {/* Nav tabs */}
      <nav
        className={`flex min-w-0 items-center gap-0.5 overflow-hidden ${collapseChromeLabels ? "ml-3" : "ml-6"}`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavTab
          label="Review"
          icon={<GitPullRequest size={14} />}
          compact={collapseNavLabels}
          active={route.view === "review"}
          onClick={() => navigate({ view: "review", prNumber: null })}
        />
        <NavTab
          label="Workflows"
          icon={<Zap size={14} />}
          compact={collapseNavLabels}
          active={route.view === "workflows"}
          onClick={() => navigate({ view: "workflows" })}
        />
        <NavTab
          label="Metrics"
          icon={<BarChart3 size={14} />}
          compact={collapseNavLabels}
          active={route.view === "metrics"}
          onClick={() => navigate({ view: "metrics" })}
        />
        <NavTab
          label="Releases"
          icon={<Tag size={14} />}
          compact={collapseNavLabels}
          active={route.view === "releases"}
          onClick={() => navigate({ view: "releases" })}
        />
        {!collapseChromeLabels && route.view === "review" && route.prNumber && (
          <>
            <span className="text-text-ghost mx-1 text-[11px]">/</span>
            <span className="text-text-tertiary font-mono text-[11px]">#{route.prNumber}</span>
          </>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Workspace switcher + icons */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Hide workspace switcher on home page — it has its own repo selector */}
        {!(route.view === "review" && !route.prNumber) && (
          <>
            <WorkspaceSwitcher compact={collapseChromeLabels} />
            <div className="bg-border mx-1 h-4 w-px" />
          </>
        )}

        <NotificationCenter />

        <IconButton
          icon={<Settings size={15} />}
          onClick={toggleSettings}
          active={route.view === "settings"}
          title="Settings"
        />

        {/* User menu */}
        <UserMenu user={user} />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// User menu
// ---------------------------------------------------------------------------

function UserMenu({
  user,
}: {
  user: { login: string; avatarUrl: string; name: string | null } | null;
}) {
  const { nwo } = useWorkspace();

  const accountsQuery = useQuery({
    queryKey: ["env", "accounts"],
    queryFn: () => ipc("env.accounts"),
    staleTime: 120_000,
  });
  const accounts = accountsQuery.data ?? [];

  const switchMutation = useMutation({
    mutationFn: (args: { host: string; login: string }) => ipc("env.switchAccount", args),
    onSuccess: () => {
      // Refresh everything after account switch
      queryClient.invalidateQueries();
    },
  });

  const activeAccount = accounts.find((a) => a.active);
  const otherAccounts = accounts.filter((a) => !a.active);

  return (
    <Menu>
      <MenuTrigger className="border-border-strong ml-1 h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border-[1.5px] transition-opacity hover:opacity-80">
        {user ? (
          <img
            src={resizeGitHubAvatarUrl(user.avatarUrl, 48)}
            alt={user.login}
            className="h-full w-full object-cover"
            loading="eager"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--primary), #7c5a2a)" }}
          >
            <span className="text-bg-root text-[10px] font-semibold">?</span>
          </div>
        )}
      </MenuTrigger>

      <MenuPopup
        side="bottom"
        align="end"
        sideOffset={6}
      >
        {/* Active account header */}
        {user && (
          <>
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="border-border-strong h-8 w-8 shrink-0 overflow-hidden rounded-full border">
                <img
                  src={resizeGitHubAvatarUrl(user.avatarUrl, 64)}
                  alt={user.login}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                {user.name && (
                  <p className="text-text-primary truncate text-sm font-medium">{user.name}</p>
                )}
                <p className="text-text-secondary truncate text-xs">{user.login}</p>
              </div>
            </div>
            <MenuSeparator />
          </>
        )}

        {/* Account switching */}
        {otherAccounts.length > 0 && (
          <>
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex items-center gap-1.5">
                  <Users size={12} />
                  Switch account
                </span>
              </MenuGroupLabel>
              {accounts.map((account) => (
                <AccountMenuItem
                  key={`${account.host}:${account.login}`}
                  account={account}
                  onSwitch={() =>
                    switchMutation.mutate({ host: account.host, login: account.login })
                  }
                  isSwitching={switchMutation.isPending}
                />
              ))}
            </MenuGroup>
            <MenuSeparator />
          </>
        )}

        {/* Quick actions */}
        <MenuGroup>
          <MenuItem
            onClick={() => {
              queryClient.invalidateQueries();
            }}
          >
            <RefreshCw size={14} />
            Refresh all data
          </MenuItem>
          <MenuItem
            onClick={() => {
              const repoUrl = `https://github.com/${nwo}`;
              void openExternal(repoUrl);
            }}
          >
            <ExternalLink size={14} />
            Open repo on GitHub
          </MenuItem>
        </MenuGroup>

        <MenuSeparator />

        {/* Sign out / auth info */}
        <MenuGroup>
          {activeAccount && (
            <MenuItem disabled>
              <LogOut size={14} />
              <span className="text-text-tertiary text-[11px]">
                Signed in via <span className="font-mono">{activeAccount.host}</span>
              </span>
            </MenuItem>
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function AccountMenuItem({
  account,
  onSwitch,
  isSwitching,
}: {
  account: GhAccount;
  onSwitch: () => void;
  isSwitching: boolean;
}) {
  return (
    <MenuItem
      onClick={() => {
        if (!account.active) {
          onSwitch();
        }
      }}
      disabled={isSwitching}
    >
      <div className="flex w-full items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={`text-xs ${account.active ? "text-text-primary font-medium" : "text-text-secondary"}`}
          >
            {account.login}
          </span>
          <span className="text-text-ghost font-mono text-[10px]">{account.host}</span>
        </div>
        {account.active && (
          <Check
            size={13}
            className="text-success shrink-0"
          />
        )}
      </div>
    </MenuItem>
  );
}

// ---------------------------------------------------------------------------
// Workspace switcher
// ---------------------------------------------------------------------------

function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { nwo, repo, switchWorkspace } = useWorkspace();
  const { navigate } = useRouter();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const repoName = repo;

  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });
  const workspaces = workspacesQuery.data ?? [];

  return (
    <Menu>
      <MenuTrigger
        aria-label={compact ? `Current repository ${repoName}` : undefined}
        title={compact ? repoName : undefined}
        className={`text-text-secondary hover:bg-bg-raised hover:text-text-primary flex shrink-0 cursor-pointer items-center rounded-sm px-2 py-1 text-xs ${
          compact ? "gap-1" : "gap-1.5"
        }`}
      >
        <GitBranch
          size={12}
          className="text-primary"
        />
        {!compact && (
          <span className="max-w-[120px] truncate font-mono text-[11px]">{repoName}</span>
        )}
        <ChevronDown
          size={10}
          className="text-text-ghost"
        />
      </MenuTrigger>

      <MenuPopup
        side="bottom"
        align="end"
        sideOffset={6}
      >
        <MenuGroup>
          <MenuGroupLabel>Workspaces</MenuGroupLabel>
          {workspaces.map((ws) => (
            <MenuItem
              key={ws.id}
              onClick={() => {
                switchWorkspace({ id: ws.id, owner: ws.owner, repo: ws.repo, path: ws.path });
                queryClient.invalidateQueries();
                navigate({ view: "review", prNumber: null });
              }}
            >
              <GitBranch
                size={12}
                className="text-primary shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate text-xs font-medium">{ws.name}</p>
                <p className="text-text-tertiary truncate font-mono text-[10px]">{ws.path}</p>
              </div>
              {`${ws.owner}/${ws.repo}` === nwo && (
                <Check
                  size={13}
                  className="text-success shrink-0"
                />
              )}
            </MenuItem>
          ))}
        </MenuGroup>

        <MenuSeparator />

        <MenuItem onClick={() => setAddRepoOpen(true)}>
          <Plus size={12} />
          Add repository...
        </MenuItem>
      </MenuPopup>

      <AddRepoDialog
        open={addRepoOpen}
        onOpenChange={setAddRepoOpen}
        onAdded={(ws) => {
          switchWorkspace({ id: ws.id, owner: ws.owner, repo: ws.repo, path: ws.path });
          queryClient.invalidateQueries();
          navigate({ view: "review", prNumber: null });
        }}
      />
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NavTab({
  label,
  icon,
  compact = false,
  active = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  compact?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`relative flex shrink-0 cursor-pointer items-center rounded-sm text-xs transition-colors ${
        compact ? "gap-0 px-2 py-1.5" : "gap-1.5 px-2.5 py-1.5"
      } ${
        active
          ? "text-text-primary font-medium"
          : "text-text-secondary hover:bg-bg-raised hover:text-text-primary font-[450]"
      }`}
    >
      {icon}
      {!compact && label}
      {active && (
        <div className="bg-primary absolute bottom-[-7px] left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px]" />
      )}
    </button>
  );

  if (!compact) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function IconButton({
  icon,
  onClick,
  active = false,
  title,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-sm transition-colors ${
        active
          ? "bg-bg-raised text-text-primary"
          : "text-text-secondary hover:bg-bg-raised hover:text-text-primary"
      }`}
    >
      {icon}
      {active && (
        <div className="bg-primary absolute bottom-[-7px] left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px]" />
      )}
    </button>
  );

  if (!title) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="bottom">{title}</TooltipPopup>
    </Tooltip>
  );
}
