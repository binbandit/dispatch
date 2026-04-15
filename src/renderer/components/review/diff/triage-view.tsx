import type { TriageFile, TriageSection } from "@/renderer/lib/review/triage-classifier";

import { getDiffFilePath, type DiffFileStatus } from "@/renderer/lib/review/diff-parser";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

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
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

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

  const visibleItems = useMemo(() => {
    const items: Array<
      | { id: string; type: "section"; section: TriageSection; index: number }
      | { id: string; type: "file"; section: TriageSection; entry: TriageFile; index: number }
    > = [];

    sections.forEach((section, index) => {
      items.push({ id: `section:${section.id}`, type: "section", section, index });

      if (isSectionExpanded(section, index)) {
        section.files.forEach((entry) => {
          items.push({
            id: `file:${entry.fileIndex}`,
            type: "file",
            section,
            entry,
            index,
          });
        });
      }
    });

    return items;
  }, [sections, collapsedSections]);

  function focusItem(itemId: string | null) {
    if (!itemId) {
      return;
    }

    setFocusedItemId(itemId);
    document
      .querySelector<HTMLElement>(`[data-triage-item-id="${CSS.escape(itemId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function getDefaultFocusedItemId() {
    const selectedItem = visibleItems.find(
      (item) => item.type === "file" && item.entry.fileIndex === currentFileIndex,
    );
    return selectedItem?.id ?? visibleItems[0]?.id ?? null;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (visibleItems.length === 0) {
      return;
    }

    const currentIndex = focusedItemId
      ? visibleItems.findIndex((item) => item.id === focusedItemId)
      : -1;
    const activeIndex = currentIndex === -1 ? 0 : currentIndex;
    const activeItem = visibleItems[activeIndex];

    if (!activeItem) {
      return;
    }

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const nextIndex = Math.min(activeIndex + 1, visibleItems.length - 1);
        focusItem(visibleItems[nextIndex]?.id ?? null);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const previousIndex = Math.max(activeIndex - 1, 0);
        focusItem(visibleItems[previousIndex]?.id ?? null);
        break;
      }
      case "ArrowRight": {
        if (
          activeItem.type === "section" &&
          !isSectionExpanded(activeItem.section, activeItem.index)
        ) {
          event.preventDefault();
          toggleSection(activeItem.section, activeItem.index);
        }
        break;
      }
      case "ArrowLeft": {
        if (
          activeItem.type === "section" &&
          isSectionExpanded(activeItem.section, activeItem.index)
        ) {
          event.preventDefault();
          toggleSection(activeItem.section, activeItem.index);
        }
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (activeItem.type === "section") {
          toggleSection(activeItem.section, activeItem.index);
        } else {
          onSelectFile(activeItem.entry.fileIndex);
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  return (
    <div
      data-review-focus-target="file-tree"
      className="focus:ring-border-accent/70 flex flex-col rounded-md focus:ring-1 focus:outline-none focus:ring-inset"
      tabIndex={0}
      onFocus={() => {
        if (!focusedItemId) {
          focusItem(getDefaultFocusedItemId());
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {meta ? <div className="px-2 pt-1 pb-1.5">{meta}</div> : null}
      {sections.map((section, index) => (
        <Section
          itemId={`section:${section.id}`}
          key={section.id}
          label={section.label}
          tone={section.tone}
          description={section.description}
          count={section.files.length}
          expanded={isSectionExpanded(section, index)}
          onToggle={() => toggleSection(section, index)}
          isFocused={focusedItemId === `section:${section.id}`}
        >
          {section.files.map((entry) => (
            <TriageFileItem
              itemId={`file:${entry.fileIndex}`}
              key={entry.fileIndex}
              entry={entry}
              isActive={currentFileIndex === entry.fileIndex}
              isViewed={viewedFiles.has(getDiffFilePath(entry.file))}
              commentCount={commentCounts.get(getDiffFilePath(entry.file)) ?? 0}
              onSelect={() => onSelectFile(entry.fileIndex)}
              isAttention={section.tone === "attention"}
              isFocused={focusedItemId === `file:${entry.fileIndex}`}
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
  itemId,
  label,
  tone,
  description,
  count,
  expanded,
  onToggle,
  isFocused,
  children,
}: {
  itemId: string;
  label: string;
  tone: TriageSection["tone"];
  description?: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  isFocused: boolean;
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
        data-triage-item-id={itemId}
        className={`hover:bg-bg-raised flex w-full cursor-pointer items-center gap-[5px] rounded-sm text-[10px] font-semibold tracking-[0.06em] uppercase select-none ${
          isFocused ? "ring-primary/50 bg-accent-muted/55 ring-1 ring-inset" : ""
        }`}
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
  itemId,
  entry,
  isActive,
  isViewed,
  commentCount,
  onSelect,
  isAttention,
  isFocused,
}: {
  itemId: string;
  entry: TriageFile;
  isActive: boolean;
  isViewed: boolean;
  commentCount: number;
  onSelect: () => void;
  isAttention?: boolean;
  isFocused: boolean;
}) {
  const filePath = getDiffFilePath(entry.file);
  const fileName = filePath.split("/").pop() ?? filePath;
  const badge = STATUS_BADGE[entry.file.status];

  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        data-triage-item-id={itemId}
        className={`flex w-full cursor-pointer items-center gap-[3px] text-left text-[11px] select-none ${
          isActive
            ? "bg-accent-muted text-text-primary"
            : `text-text-secondary hover:bg-bg-raised hover:text-text-primary`
        } ${isViewed ? "opacity-50" : ""} ${isFocused && !isActive ? "ring-primary/50 ring-1 ring-inset" : ""}`}
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
