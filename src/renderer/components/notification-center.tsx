import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Bell, CheckCircle2, GitMerge, GitPullRequest } from "lucide-react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";

/**
 * Notification center — Phase 3 §3.5
 *
 * Bell icon in navbar with unread badge. Popover shows recent notifications.
 */

export function NotificationCenter() {
  const { navigate } = useRouter();
  const { switchWorkspace } = useWorkspace();

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => ipc("notifications.list", { limit: 30 }),
    refetchInterval: 30_000,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markReadMutation = useMutation({
    mutationFn: (id: number) => ipc("notifications.markRead", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => ipc("notifications.markAllRead"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const iconForType = (type: string) => {
    switch (type) {
      case "review":
        return GitPullRequest;
      case "ci-fail":
        return AlertCircle;
      case "approve":
        return CheckCircle2;
      case "merge":
        return GitMerge;
      default:
        return Bell;
    }
  };

  const colorForType = (type: string) => {
    switch (type) {
      case "review":
        return "text-info";
      case "ci-fail":
        return "text-destructive";
      case "approve":
        return "text-success";
      case "merge":
        return "text-primary";
      default:
        return "text-text-tertiary";
    }
  };

  return (
    <Menu>
      <MenuTrigger className="text-text-secondary hover:bg-bg-raised hover:text-text-primary relative flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-sm transition-colors">
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="bg-destructive text-bg-root absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[8px] font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </MenuTrigger>

      <MenuPopup
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-80"
      >
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-text-primary text-xs font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllReadMutation.mutate()}
              className="text-primary hover:text-accent-hover cursor-pointer text-[10px]"
            >
              Mark all read
            </button>
          )}
        </div>
        <MenuSeparator />

        {notifications.length === 0 ? (
          <div className="text-text-tertiary px-3 py-6 text-center text-xs">
            No notifications yet
          </div>
        ) : (
          <MenuGroup>
            {notifications.slice(0, 15).map((notification) => {
              const Icon = iconForType(notification.type);
              const color = colorForType(notification.type);
              return (
                <MenuItem
                  key={notification.id}
                  onClick={() => {
                    if (!notification.read) {
                      markReadMutation.mutate(notification.id);
                    }
                    if (notification.workspace) {
                      switchWorkspace(notification.workspace);
                    }
                    if (notification.prNumber) {
                      navigate({ view: "review", prNumber: notification.prNumber });
                    }
                  }}
                >
                  <div
                    className={`flex w-full items-start gap-2 ${notification.read ? "opacity-50" : ""}`}
                  >
                    <div className="relative mt-0.5 shrink-0">
                      {notification.authorLogin ? (
                        <>
                          <GitHubAvatar
                            login={notification.authorLogin}
                            size={20}
                          />
                          <div
                            className={`bg-bg-elevated absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full`}
                          >
                            <Icon
                              size={9}
                              className={color}
                            />
                          </div>
                        </>
                      ) : (
                        <Icon
                          size={14}
                          className={color}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary truncate text-[11px] font-medium">
                        {notification.title}
                      </p>
                      {notification.body && (
                        <p className="text-text-tertiary mt-0.5 truncate text-[10px]">
                          {notification.body}
                        </p>
                      )}
                      <p className="text-text-ghost mt-0.5 font-mono text-[9px]">
                        {relativeTime(new Date(notification.createdAt))}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="bg-primary mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                    )}
                  </div>
                </MenuItem>
              );
            })}
          </MenuGroup>
        )}
      </MenuPopup>
    </Menu>
  );
}
