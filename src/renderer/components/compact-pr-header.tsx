import type { GhPrDetail } from "@/shared/ipc";

import { ExternalLink, PanelRight } from "lucide-react";

import { openExternal } from "../lib/open-external";
import { GitHubAvatar } from "./github-avatar";

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
}

export function CompactPrHeader({
  pr,
  panelOpen,
  onTogglePanel,
  totalAdditions,
  totalDeletions,
  showPanelToggle,
}: CompactPrHeaderProps) {
  return (
    <div className="border-border bg-bg-surface flex h-9 shrink-0 items-center gap-2 border-b px-4">
      {/* Author avatar + login */}
      <GitHubAvatar
        login={pr.author.login}
        size={20}
        className="border-border-strong shrink-0 border"
      />
      <span className="text-text-secondary shrink-0 font-mono text-[11px]">{pr.author.login}</span>

      {/* Draft badge */}
      {pr.isDraft && (
        <span className="bg-warning-muted text-warning shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-semibold">
          Draft
        </span>
      )}

      {/* PR Title — most prominent element (14px, 700) */}
      <span
        className="text-text-primary min-w-0 flex-1 truncate"
        style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.02em" }}
      >
        {pr.title}
      </span>

      {/* PR number */}
      <span className="text-text-tertiary shrink-0 font-mono text-[11px]">#{pr.number}</span>

      {/* Meta inline */}
      <div className="flex shrink-0 items-center gap-[5px]">
        {/* Branch badge */}
        <span
          className="border-border bg-bg-raised text-accent-text shrink-0 rounded-sm border font-mono text-[10px]"
          style={{ padding: "0 5px" }}
        >
          {pr.headRefName}
        </span>
        <span className="text-text-ghost text-[9px]">•</span>
        <span className="text-success font-mono text-[10px]">+{totalAdditions}</span>
        <span className="text-text-ghost text-[9px]">•</span>
        <span className="text-destructive font-mono text-[10px]">-{totalDeletions}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* External link */}
      <button
        type="button"
        onClick={() => void openExternal(pr.url)}
        className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent transition-colors"
        title="Open on GitHub"
      >
        <ExternalLink size={13} />
      </button>

      {/* Panel toggle */}
      {showPanelToggle && (
        <button
          type="button"
          onClick={onTogglePanel}
          className={`flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors ${
            panelOpen
              ? "bg-accent-muted text-accent-text border-border-accent"
              : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary hover:border-border border-transparent"
          }`}
          title={panelOpen ? "Hide panel" : "Show panel (i)"}
        >
          <PanelRight size={14} />
        </button>
      )}
    </div>
  );
}
