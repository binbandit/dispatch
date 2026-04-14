/* eslint-disable import/max-dependencies -- This popover is a small composition root for notifications, routing, and workspace switching. */
import type { Workspace } from "@/shared/ipc";

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useRouter } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Bell, CheckCircle2, GitMerge, GitPullRequest, Inbox, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/**
 * Notification center — bell icon in navbar with unread badge.
 *
 * Popover shows recent notifications with unread/all filter.
 * Visual language mirrors the PR sidebar: flat rows, status dot,
 * dense mono metadata, toggle group filter matching §8.11.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string }> = {
  review: { icon: GitPullRequest, color: "text-info" },
  "ci-fail": { icon: AlertCircle, color: "text-destructive" },
  approve: { icon: CheckCircle2, color: "text-success" },
  merge: { icon: GitMerge, color: "text-success" },
};

function resolveType(type: string) {
  return TYPE_CONFIG[type] ?? { icon: Bell, color: "text-text-tertiary" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationCenter() {
  const { navigate } = useRouter();
  const { cwd, nwo, switchWorkspace } = useWorkspace();
  const [tab, setTab] = useState<"unread" | "all">("unread");

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => ipc("notifications.list", { limit: 50 }),
    refetchInterval: 30_000,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const visible = tab === "unread" ? notifications.filter((n) => !n.read) : notifications;
  const hasNotifications = notifications.length > 0;

  const workspaceQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
    staleTime: 60_000,
  });

  const getWorkspace = useCallback(
    (workspace: string): Workspace | null => {
      if (!workspace) {
        return null;
      }

      const workspaces = workspaceQuery.data ?? [];

      return (
        workspaces.find((entry) => entry.path === workspace) ??
        workspaces.find((entry) => `${entry.owner}/${entry.repo}` === workspace) ??
        null
      );
    },
    [workspaceQuery.data],
  );

  const workspaceNwo = useMemo(() => {
    if (cwd) {
      const current = getWorkspace(cwd);
      if (current) {
        return `${current.owner}/${current.repo}`;
      }
    }
    return nwo;
  }, [cwd, getWorkspace, nwo]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => ipc("notifications.markRead", { id }),
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => ipc("notifications.markAllRead"),
    onSuccess: invalidate,
  });

  const clearAllMutation = useMutation({
    mutationFn: () => ipc("notifications.clearAll"),
    onSuccess: invalidate,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => ipc("notifications.dismiss", { id }),
    onSuccess: invalidate,
  });

  const openNotification = useCallback(
    (notification: { id: number; prNumber: number; workspace: string; read: boolean }) => {
      if (notification.workspace) {
        const targetWorkspace = getWorkspace(notification.workspace);

        if (
          targetWorkspace &&
          `${targetWorkspace.owner}/${targetWorkspace.repo}` !== workspaceNwo
        ) {
          switchWorkspace(targetWorkspace);
        }
      }

      if (!notification.read) {
        markReadMutation.mutate(notification.id);
      }

      if (notification.prNumber) {
        navigate({ view: "review", prNumber: notification.prNumber });
      }
    },
    [getWorkspace, markReadMutation, navigate, switchWorkspace, workspaceNwo],
  );

  return (
    <Popover>
      <PopoverTrigger
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary relative flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-sm transition-colors"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell
          size={15}
          aria-hidden="true"
        />
        {unreadCount > 0 && (
          <span className="bg-accent border-bg-surface absolute -top-0.5 -right-0.5 h-[6px] w-[6px] rounded-full border-[1.5px]" />
        )}
      </PopoverTrigger>

      <PopoverPopup
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-[340px]"
      >
        {/* ---- Header ---- */}
        <div className="px-3 pt-0 pb-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em]">Notifications</h3>
            {hasNotifications && (
              <div className="flex items-center">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllReadMutation.mutate()}
                    className="text-text-tertiary hover:text-text-primary cursor-pointer rounded-sm px-1.5 py-0.5 text-[11px] transition-colors"
                  >
                    Read all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => clearAllMutation.mutate()}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer rounded-sm px-1.5 py-0.5 text-[11px] transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Toggle group — only show when there are notifications */}
          {hasNotifications && (
            <div className="bg-bg-raised mt-2 flex gap-0.5 rounded-md p-0.5">
              <FilterButton
                label="Unread"
                count={unreadCount}
                active={tab === "unread"}
                onClick={() => setTab("unread")}
              />
              <FilterButton
                label="All"
                count={notifications.length}
                active={tab === "all"}
                onClick={() => setTab("all")}
              />
            </div>
          )}
        </div>

        {/* ---- List ---- */}
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 pt-4 pb-8 text-center">
            <Inbox
              size={20}
              className="text-text-ghost"
            />
            <p className="text-text-tertiary mt-2 text-xs">
              {tab === "unread" && hasNotifications
                ? "No unread notifications"
                : "No notifications yet"}
            </p>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto">
            {visible.map((notification) => {
              const { icon: Icon, color } = resolveType(notification.type);

              return (
                <div
                  key={notification.id}
                  className="group relative flex items-start gap-2 px-3 py-[7px] transition-colors hover:bg-[var(--bg-raised)]"
                >
                  {/* Unread bar */}
                  <div
                    className={`absolute top-0 left-0 h-full w-[2px] ${notification.read ? "bg-transparent" : "bg-accent"}`}
                  />

                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
                    onClick={() => {
                      openNotification(notification);
                    }}
                  >
                    {/* Avatar / icon */}
                    <div className="relative mt-px shrink-0">
                      {notification.authorLogin ? (
                        <>
                          <GitHubAvatar
                            login={notification.authorLogin}
                            size={22}
                          />
                          <div className="bg-bg-surface absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full">
                            <Icon
                              size={9}
                              className={color}
                            />
                          </div>
                        </>
                      ) : (
                        <div
                          className={`flex h-[22px] w-[22px] items-center justify-center ${color}`}
                        >
                          <Icon size={14} />
                        </div>
                      )}
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-xs leading-[18px] ${notification.read ? "text-text-secondary" : "text-text-primary font-medium"}`}
                      >
                        {notification.title}
                      </p>
                      <div className="text-text-tertiary mt-px flex items-center gap-1 font-mono text-[10px]">
                        {notification.body && (
                          <>
                            <span className="truncate">{notification.body}</span>
                            <span className="text-text-ghost">&middot;</span>
                          </>
                        )}
                        <time
                          dateTime={notification.createdAt}
                          className="text-text-ghost shrink-0"
                        >
                          {relativeTime(new Date(notification.createdAt))}
                        </time>
                      </div>
                    </div>
                  </button>

                  {/* Dismiss */}
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={() => dismissMutation.mutate(notification.id)}
                    className="text-text-ghost hover:text-text-secondary mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-0 transition-[opacity,color] group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Filter button — matches the PR inbox toggle group pattern (§8.11)
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
      className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm px-2.5 py-[3px] text-[11px] font-medium transition-colors select-none ${
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
