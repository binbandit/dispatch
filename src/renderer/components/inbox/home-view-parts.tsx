/* eslint-disable import/max-dependencies -- This module intentionally groups the home dashboard's presentational rows and badges. */
import type { Workspace } from "@/shared/ipc";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { formatAuthorName } from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import {
  getDashboardPrKey,
  type DashboardPr,
  type EnrichedDashboardPr,
  type PrSection,
} from "@/renderer/lib/inbox/home-prs";
import { useMutation } from "@tanstack/react-query";
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
import { type FocusEvent, type RefObject, useMemo, useRef, useState } from "react";

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
    return {
      short: `${mins}m`,
      full: `${mins} minute${mins === 1 ? "" : "s"} ago`,
    };
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return { short: `${hrs}h`, full: `${hrs} hour${hrs === 1 ? "" : "s"} ago` };
  }
  const days = Math.floor(hrs / 24);
  return { short: `${days}d`, full: `${days} day${days === 1 ? "" : "s"} ago` };
}

function prSizeLabel(
  additions: number,
  deletions: number,
): { label: string; fullLabel: string; cls: string } | null {
  const total = additions + deletions;
  if (total === 0) {
    return null;
  }
  if (total < 50) {
    return {
      label: "S",
      fullLabel: "Small change",
      cls: "bg-success-muted text-success",
    };
  }
  if (total < 200) {
    return {
      label: "M",
      fullLabel: "Medium change",
      cls: "bg-warning-muted text-warning",
    };
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

interface StatusTag {
  label: string;
  colorClass: string;
  icon:
    | "review"
    | "changes"
    | "failing"
    | "approved"
    | "waiting"
    | "running"
    | "draft"
    | "closed"
    | "merged";
}

function resolveStatusTag(pr: DashboardPr, currentUser: string | null): StatusTag | null {
  if (pr.state === "MERGED") {
    return {
      label: "Merged",
      colorClass: "text-purple opacity-60",
      icon: "merged",
    };
  }
  if (pr.state === "CLOSED") {
    return {
      label: "Closed",
      colorClass: "text-destructive opacity-70",
      icon: "closed",
    };
  }
  if (pr.isDraft) {
    return { label: "Draft", colorClass: "text-text-secondary", icon: "draft" };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return {
      label: "Changes requested",
      colorClass: "text-warning",
      icon: "changes",
    };
  }
  if (pr.reviewDecision === "APPROVED") {
    return {
      label: "Approved",
      colorClass: "text-success",
      icon: "approved",
    };
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED" || pr.reviewDecision === "") {
    if (currentUser && pr.author.login === currentUser) {
      return {
        label: "Awaiting review",
        colorClass: "text-text-secondary",
        icon: "waiting",
      };
    }
    return {
      label: "Review requested",
      colorClass: "text-purple",
      icon: "review",
    };
  }
  return null;
}

function resolveBarColor(pr: DashboardPr, currentUser: string | null): string {
  if (pr.state === "MERGED") {
    return "bg-purple opacity-30";
  }
  if (pr.state === "CLOSED") {
    return "bg-destructive opacity-30";
  }
  if (pr.isDraft) {
    return "bg-text-ghost";
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return "bg-warning";
  }
  if (pr.reviewDecision === "APPROVED") {
    return "bg-success";
  }
  if (currentUser && pr.author.login !== currentUser) {
    return "bg-purple";
  }
  if (currentUser && pr.author.login === currentUser && pr.reviewDecision === "APPROVED") {
    return "bg-success";
  }
  return "bg-purple opacity-40";
}

export function RepoSelector({
  cwd,
  repoName,
  activeWorkspaceCount,
  workspaces,
  workspaceCounts,
  open,
  onToggle,
  onSelect,
  onAddRepo,
  containerRef,
  onBlur,
}: {
  cwd: string;
  repoName: string;
  activeWorkspaceCount: number;
  workspaces: Workspace[];
  workspaceCounts: Map<string, number>;
  open: boolean;
  onToggle: () => void;
  onSelect: (workspace: Workspace) => void;
  onAddRepo: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  onBlur: (event: FocusEvent) => void;
}) {
  const [repoSearch, setRepoSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!repoSearch.trim()) {
      return workspaces;
    }
    const q = repoSearch.toLowerCase();
    return workspaces.filter((workspace) => workspace.name.toLowerCase().includes(q));
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
        aria-label={`Active repository: ${repoName}. ${activeWorkspaceCount} pull requests in this repository`}
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
        {activeWorkspaceCount > 0 && (
          <span
            className="bg-accent-muted text-accent-text flex h-4 min-w-4 items-center justify-center rounded-full px-[5px] font-mono text-[9px] font-semibold"
            aria-hidden="true"
          >
            {activeWorkspaceCount}
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
              onChange={(event) => setRepoSearch(event.target.value)}
              placeholder="Find a repository..."
              className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onToggle();
                }
              }}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map((workspace) => {
              const isActive = workspace.path === cwd;
              const workspaceCount = isActive
                ? activeWorkspaceCount
                : (workspaceCounts.get(workspace.path ?? "") ?? 0);
              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    if (isActive) {
                      onToggle();
                    } else {
                      onSelect(workspace);
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
                      {workspace.name}
                    </div>
                  </div>
                  {workspaceCount > 0 && (
                    <span className="text-text-secondary shrink-0 font-mono text-[10px]">
                      {workspaceCount}
                    </span>
                  )}
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

export function PrSectionView({
  section,
  collapsed,
  onToggle,
  currentUser,
  nameFormat,
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
  onSelectPr: (item: EnrichedDashboardPr) => void;
  focusIndex: number;
  flatPrs: EnrichedDashboardPr[];
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
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${section.title}, ${section.items.length} pull requests`}
        className="flex w-full cursor-pointer items-center gap-1.5 px-0.5 pt-2.5 pb-1.5 text-left"
      >
        <span className={`text-[11px] font-semibold tracking-[0.01em] ${titleClass}`}>
          {section.title}
        </span>
        <span
          className="text-text-secondary font-mono text-[10px]"
          aria-label={`${section.items.length} pull requests`}
        >
          {section.items.length}
        </span>
        <div className="flex-1" />
        <span
          className="text-text-tertiary p-0.5 transition-transform"
          style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}
        >
          <ChevronDown
            size={13}
            aria-hidden="true"
          />
        </span>
      </button>

      {!collapsed && section.items.length > 0 && (
        <div className={bodyClass}>
          {section.items.map((item) => {
            const flatIndex = flatPrs.indexOf(item);
            return (
              <PrRow
                key={getDashboardPrKey(item.pr.pullRequestRepository, item.pr.number)}
                item={item}
                currentUser={currentUser}
                nameFormat={nameFormat}
                onClick={() => onSelectPr(item)}
                isFocused={flatIndex === focusIndex}
                isShipSection={section.id === "ship"}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrRow({
  item,
  currentUser,
  nameFormat,
  onClick,
  isFocused,
  isShipSection,
}: {
  item: EnrichedDashboardPr;
  currentUser: string | null;
  nameFormat: "login" | "name";
  onClick: () => void;
  isFocused: boolean;
  isShipSection: boolean;
}) {
  const { pr, hasNewActivity } = item;
  const statusTag = resolveStatusTag(pr, currentUser);
  const barColor = resolveBarColor(pr, currentUser);
  const size = prSizeLabel(pr.additions, pr.deletions);
  const isDim = pr.state === "MERGED" || pr.state === "CLOSED" || pr.isDraft;
  const isAuthor = currentUser && pr.author.login === currentUser;
  const authorDisplay = isAuthor ? "you" : formatAuthorName(pr.author, nameFormat);

  const mergeMutation = useMutation({
    mutationFn: () =>
      ipc("pr.merge", {
        cwd: pr.workspacePath,
        owner: pr.pullRequestRepository.split("/")[0] ?? "",
        repo: pr.pullRequestRepository.split("/")[1] ?? "",
        prNumber: pr.number,
        strategy: "squash",
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: result.queued ? `PR #${pr.number} added to merge queue` : `PR #${pr.number} merged`,
        type: "success",
      });
    },
    onError: (error) => {
      toastManager.add({
        title: "Merge failed",
        description: String(error.message),
        type: "error",
      });
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
      <div
        className={`w-0.5 shrink-0 rounded-r-sm opacity-80 ${barColor}`}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1 px-2.5 py-[7px]">
        <div className="flex items-baseline gap-2.5">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${isDim ? "text-text-secondary font-normal" : "text-text-primary font-medium"}`}
          >
            {pr.title}
          </span>

          {isShipSection && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
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

        <div className="mt-px flex items-center gap-1.5">
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

          <div className="flex shrink-0 items-center gap-1.5">
            {statusTag && <StatusTagBadge tag={statusTag} />}

            {isShipSection && size && (
              <span aria-label={`${pr.additions} additions, ${pr.deletions} deletions`}>
                <span
                  className="text-success font-mono text-[10px]"
                  aria-hidden="true"
                >
                  +{pr.additions}
                </span>{" "}
                <span
                  className="text-destructive font-mono text-[10px]"
                  aria-hidden="true"
                >
                  &minus;{pr.deletions}
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
  const className = "h-[9px] w-[9px]";
  const strokeWidth = 2.5;
  const hidden = { "aria-hidden": true as const };

  switch (icon) {
    case "review": {
      return (
        <Eye
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "changes": {
      return (
        <Pencil
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "failing": {
      return (
        <XCircle
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "approved": {
      return (
        <Check
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "waiting": {
      return (
        <Loader2
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "running": {
      return (
        <Loader2
          size={9}
          strokeWidth={strokeWidth}
          className={`${className} animate-spin`}
          {...hidden}
        />
      );
    }
    case "draft": {
      return (
        <Pencil
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "merged": {
      return (
        <GitMerge
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
    case "closed": {
      return (
        <XCircle
          size={9}
          strokeWidth={strokeWidth}
          className={className}
          {...hidden}
        />
      );
    }
  }
}

export function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="text-text-tertiary flex items-center gap-1 text-[10px]">
      {keys.map((key) => (
        <Kbd
          key={key}
          className="h-[18px] min-w-[18px] px-1 text-[9px]"
        >
          {key}
        </Kbd>
      ))}
      <span>{label}</span>
    </div>
  );
}
