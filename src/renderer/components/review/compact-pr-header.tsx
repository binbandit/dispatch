/* eslint-disable import/max-dependencies -- This header intentionally composes several small review controls. */
import type { GhPrDetail } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import {
  formatAuthorName,
  useDisplayNameFormat,
} from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { getCompletedPullRequestLabel } from "@/renderer/lib/review/completed-pr-state";
import { useMutation } from "@tanstack/react-query";
import { Copy, ExternalLink, Link, PanelRight, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Compact PR header — PR-REVIEW-REDESIGN.md § PR Header (36px, single strip)
 *
 * 20px avatar · draft badge · title (14px/700) · #number · branch badge · stats
 * Right side: external link icon btn, panel toggle icon btn
 */

interface CompactPrHeaderProps {
  pr: GhPrDetail;
  isAuthor: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  cwd: string;
  totalAdditions: number;
  totalDeletions: number;
  showPanelToggle: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
  canEdit?: boolean;
}

export function CompactPrHeader({
  pr,
  panelOpen,
  onTogglePanel,
  totalAdditions,
  totalDeletions,
  showPanelToggle,
  isRefreshing,
  onRefresh,
  canEdit,
}: CompactPrHeaderProps) {
  const { cwd } = useWorkspace();
  const nameFormat = useDisplayNameFormat();
  const compactHeader = useMediaQuery({ max: 1160 });
  const denseHeader = useMediaQuery({ max: 940 });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(pr.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const completedLabel = getCompletedPullRequestLabel(pr.state);

  const titleMutation = useMutation({
    mutationFn: (title: string) => ipc("pr.updateTitle", { cwd, prNumber: pr.number, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      setEditing(false);
    },
    onError: (err: Error) => {
      toastManager.add({
        title: "Failed to update title",
        description: err.message,
        type: "error",
      });
    },
  });

  const startEditing = () => {
    if (!canEdit) {
      return;
    }
    setEditValue(pr.title);
    setEditing(true);
  };

  const saveTitle = () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === pr.title) {
      setEditing(false);
      return;
    }
    titleMutation.mutate(trimmed);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditValue(pr.title);
  };

  return (
    <div
      className={`border-border bg-bg-surface shrink-0 border-b py-2 ${denseHeader ? "px-3" : "px-4"}`}
    >
      {/* Row 1: Avatar + name + draft badge + title + buttons */}
      <div className="flex h-[22px] min-w-0 items-center gap-2">
        <GitHubAvatar
          login={pr.author.login}
          size={20}
          className="border-border-strong shrink-0 border"
        />
        {!compactHeader && (
          <span className="text-text-secondary min-w-0 shrink truncate font-mono text-[11px]">
            {formatAuthorName(pr.author, nameFormat)}
          </span>
        )}

        {pr.isDraft && (
          <span className="bg-warning-muted text-warning shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-semibold">
            Draft
          </span>
        )}
        {completedLabel && (
          <span
            className={`shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-semibold ${
              pr.state === "MERGED"
                ? "bg-purple-muted text-purple"
                : "bg-danger-muted text-destructive"
            }`}
          >
            {completedLabel}
          </span>
        )}

        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveTitle();
              } else if (e.key === "Escape") {
                cancelEditing();
              }
            }}
            onBlur={saveTitle}
            disabled={titleMutation.isPending}
            className="text-text-primary border-primary bg-bg-root min-w-0 flex-1 rounded-sm border px-1.5 focus:outline-none"
            style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.02em", height: "22px" }}
          />
        ) : (
          <span
            onClick={startEditing}
            className={`text-text-primary min-w-0 flex-1 truncate ${canEdit ? "hover:bg-bg-raised -mx-1.5 cursor-pointer rounded-sm px-1.5 transition-colors" : ""}`}
            style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.02em" }}
            title={canEdit ? "Click to edit title" : undefined}
          >
            {pr.title}
          </span>
        )}

        {/* Refresh PR data */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors disabled:cursor-default disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={isRefreshing ? "animate-spin" : ""}
                />
              </button>
            }
          />
          <TooltipPopup>Refresh PR</TooltipPopup>
        </Tooltip>

        {!compactHeader && (
          <>
            {/* Copy PR number */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(`#${pr.number}`);
                      toastManager.add({ title: `Copied #${pr.number}`, type: "success" });
                    }}
                    className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors"
                  >
                    <Copy size={13} />
                  </button>
                }
              />
              <TooltipPopup>Copy PR number</TooltipPopup>
            </Tooltip>

            {/* Copy PR link */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(pr.url);
                      toastManager.add({ title: "PR URL copied", type: "success" });
                    }}
                    className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors"
                  >
                    <Link size={13} />
                  </button>
                }
              />
              <TooltipPopup>Copy PR link</TooltipPopup>
            </Tooltip>
          </>
        )}

        {/* External link */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => void openExternal(pr.url)}
                className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors"
              >
                <ExternalLink size={13} />
              </button>
            }
          />
          <TooltipPopup>Open on GitHub</TooltipPopup>
        </Tooltip>

        {/* Panel toggle */}
        {showPanelToggle && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onTogglePanel}
                  className={`flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors ${
                    panelOpen
                      ? "bg-accent-muted text-accent-text border-border-accent"
                      : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border border-transparent"
                  }`}
                >
                  <PanelRight size={14} />
                </button>
              }
            />
            <TooltipPopup>{panelOpen ? "Hide panel" : "Show panel (i)"}</TooltipPopup>
          </Tooltip>
        )}
      </div>

      {/* Row 2: PR number + branch + stats — aligned with author name (20px avatar + 8px gap) */}
      <div className="flex min-w-0 items-center gap-[5px] pt-0.5 pl-7">
        <span className="text-text-tertiary shrink-0 font-mono text-[11px]">#{pr.number}</span>
        <span className="text-text-ghost text-[9px]">·</span>
        <span
          className="border-border bg-bg-raised text-accent-text min-w-0 truncate rounded-sm border font-mono text-[10px]"
          style={{ padding: "0 5px" }}
        >
          {pr.headRefName}
        </span>
        {!denseHeader && (
          <>
            <span className="text-text-ghost text-[9px]">·</span>
            <span className="text-success shrink-0 font-mono text-[10px]">+{totalAdditions}</span>
            <span className="text-text-ghost shrink-0 text-[9px]">·</span>
            <span className="text-destructive shrink-0 font-mono text-[10px]">
              -{totalDeletions}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
