import type { TriageFile, TriageSection } from "@/renderer/lib/review/triage-classifier";

import { getDiffFilePath, type DiffFileStatus } from "@/renderer/lib/review/diff-parser";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

/**
 * Triage view — PR-REVIEW-REDESIGN.md § Triage mode
 *
 * Groups files into: Needs Attention (orange) / Changed (blue) / Low Risk (gray)
 * Each section is collapsible. Files show badges, annotations, and stats.
 */

interface TriageViewProps {
  sections: ReadonlyArray<TriageSection>;
  currentFileIndex: number;
  onSelectFile: (index: number) => void;
  viewedFiles: Set<string>;
  commentCounts: Map<string, number>;
  meta?: React.ReactNode;
}

export function TriageView({
  sections,
  currentFileIndex,
  onSelectFile,
  viewedFiles,
  commentCounts,
  meta,
}: TriageViewProps) {
  const TRIAGE_KEY = "dispatch-triage-collapsed";
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem(TRIAGE_KEY);
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  function isSectionExpanded(section: TriageSection, index: number): boolean {
    const stored = collapsedSections[section.id];
    if (stored !== undefined) {
      return !stored;
    }

    return section.tone === "attention" || index < 2;
  }

  function toggleSection(section: TriageSection, index: number) {
    const expanded = isSectionExpanded(section, index);
    setCollapsedSections((prev) => {
      const next = { ...prev, [section.id]: expanded };
      sessionStorage.setItem(TRIAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      {meta ? <div className="px-2 pt-1 pb-1.5">{meta}</div> : null}
      {sections.map((section, index) => (
        <Section
          key={section.id}
          label={section.label}
          tone={section.tone}
          description={section.description}
          count={section.files.length}
          expanded={isSectionExpanded(section, index)}
          onToggle={() => toggleSection(section, index)}
        >
          {section.files.map((entry) => (
            <TriageFileItem
              key={entry.fileIndex}
              entry={entry}
              isActive={currentFileIndex === entry.fileIndex}
              isViewed={viewedFiles.has(getDiffFilePath(entry.file))}
              commentCount={commentCounts.get(getDiffFilePath(entry.file)) ?? 0}
              onSelect={() => onSelectFile(entry.fileIndex)}
              isAttention={section.tone === "attention"}
            />
          ))}
        </Section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  label,
  tone,
  description,
  count,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  tone: TriageSection["tone"];
  description?: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const dotColor =
    tone === "attention"
      ? "var(--accent-text)"
      : tone === "changed"
        ? "var(--info)"
        : "var(--text-ghost)";

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-[5px] rounded-sm text-[10px] font-semibold tracking-[0.06em] uppercase select-none"
        style={{ padding: "6px 7px", color: "var(--text-tertiary)" }}
      >
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
        {expanded ? (
          <ChevronDown
            size={10}
            className="text-text-ghost shrink-0"
          />
        ) : (
          <ChevronRight
            size={10}
            className="text-text-ghost shrink-0"
          />
        )}
        {label}
        <span className="text-text-ghost ml-auto font-mono text-[9px] font-normal tracking-normal normal-case">
          {count}
        </span>
      </button>
      {description && expanded ? (
        <div className="text-text-secondary px-[22px] pb-1 text-[10px] leading-[1.35]">
          {description}
        </div>
      ) : null}
      {expanded && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

const STATUS_BADGE: Record<DiffFileStatus, { label: string; className: string }> = {
  added: { label: "A", className: "bg-success-muted text-success" },
  deleted: { label: "D", className: "bg-danger-muted text-destructive" },
  renamed: { label: "R", className: "bg-purple-muted text-purple" },
  modified: { label: "M", className: "bg-warning-muted text-warning" },
};

function TriageFileItem({
  entry,
  isActive,
  isViewed,
  commentCount,
  onSelect,
  isAttention,
}: {
  entry: TriageFile;
  isActive: boolean;
  isViewed: boolean;
  commentCount: number;
  onSelect: () => void;
  isAttention?: boolean;
}) {
  const filePath = getDiffFilePath(entry.file);
  const fileName = filePath.split("/").pop() ?? filePath;
  const badge = STATUS_BADGE[entry.file.status];

  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full cursor-pointer items-center gap-[3px] text-left text-[11px] select-none ${
          isActive
            ? "bg-accent-muted text-text-primary"
            : `text-text-secondary hover:bg-bg-raised hover:text-text-primary`
        } ${isViewed ? "opacity-50" : ""}`}
        style={{
          padding: isActive ? "5px 7px 5px 12px" : "5px 7px 5px 14px",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          borderRadius: "var(--radius-sm)",
          boxShadow: isActive
            ? "inset 2px 0 0 var(--accent), 0 0 8px rgba(212,136,58,0.05)"
            : "none",
        }}
      >
        {/* File badge (12x12) */}
        <span
          className={`flex shrink-0 items-center justify-center rounded-xs text-[8px] font-bold ${badge.className}`}
          style={{ width: "12px", height: "12px" }}
        >
          {badge.label}
        </span>

        {/* Filename */}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{fileName}</span>

        {/* Comment badge */}
        {commentCount > 0 && (
          <span className="bg-warning-muted text-warning shrink-0 rounded-xs px-[3px] font-mono text-[8px] font-medium">
            {commentCount}
          </span>
        )}

        {/* Stats */}
        {entry.file.additions > 0 && (
          <span className="text-success shrink-0 font-mono text-[9px]">
            +{entry.file.additions}
          </span>
        )}
        {entry.file.deletions > 0 && (
          <span className="text-destructive shrink-0 font-mono text-[9px]">
            -{entry.file.deletions}
          </span>
        )}
      </button>

      {/* File annotation */}
      {entry.annotation && (
        <div
          className="truncate text-[10px] leading-[1.3]"
          style={{
            padding: "0 7px 2px 27px",
            color: isAttention ? "var(--text-secondary)" : "var(--text-tertiary)",
            fontStyle: isAttention ? "normal" : "italic",
            fontWeight: isAttention ? 450 : 400,
          }}
        >
          {entry.annotation}
        </div>
      )}
    </div>
  );
}
