import type { DiffMode } from "./diff-viewer";

import { Kbd } from "@/components/ui/kbd";
import { Check, ChevronLeft, ChevronRight, Columns2, FileText, Rows2 } from "lucide-react";

import { getDiffFilePath, type DiffFile } from "../lib/diff-parser";

/**
 * Diff toolbar — PR-REVIEW-REDESIGN.md § Diff Toolbar (32px)
 *
 * File path (mono, dir dimmed), "Since review" callout,
 * Unified/Split toggle, Viewed toggle with `v` kbd hint, file nav.
 */

export function DiffToolbar({
  currentFile,
  currentIndex,
  totalFiles,
  onPrev,
  onNext,
  diffMode,
  onDiffModeChange,
  hasLastReview,
  viewMode,
  onViewModeChange,
  isViewed,
  onToggleViewed,
  hideReviewControls,
}: {
  currentFile: DiffFile | null;
  currentIndex: number;
  totalFiles: number;
  onPrev: () => void;
  onNext: () => void;
  diffMode: "all" | "since-review";
  onDiffModeChange: (mode: "all" | "since-review") => void;
  hasLastReview: boolean;
  viewMode: DiffMode;
  onViewModeChange: (mode: DiffMode) => void;
  isViewed: boolean;
  onToggleViewed: () => void;
  hideReviewControls?: boolean;
}) {
  const filePath = currentFile ? getDiffFilePath(currentFile) : "";
  const fileName = filePath.split("/").pop() ?? "";
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";

  return (
    <div className="border-border-subtle bg-bg-surface flex h-8 shrink-0 items-center gap-2 border-b px-3">
      {/* File path */}
      <span className="text-text-tertiary min-w-0 truncate font-mono text-[11px] font-medium">
        {dirPath}
        <span className="text-text-secondary">{fileName}</span>
      </span>

      <div className="flex-1" />

      {/* "Since review" callout — hidden in commit view */}
      {!hideReviewControls && hasLastReview && diffMode === "since-review" && (
        <span className="bg-purple-muted text-purple flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium">
          Since last review
          <button
            type="button"
            onClick={() => onDiffModeChange("all")}
            className="text-purple cursor-pointer text-[10px] hover:underline"
          >
            Show all
          </button>
        </span>
      )}

      {!hideReviewControls && hasLastReview && diffMode === "all" && (
        <button
          type="button"
          onClick={() => onDiffModeChange("since-review")}
          className="text-purple hover:bg-purple-muted cursor-pointer rounded-md px-2 py-0.5 text-[10px] transition-colors"
        >
          Since review
        </button>
      )}

      {/* View mode toggle: Unified / Split / Full file */}
      <div className="border-border bg-bg-raised flex items-center rounded-md border p-[2px]">
        <button
          type="button"
          onClick={() => onViewModeChange("unified")}
          className={`flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            viewMode === "unified"
              ? "bg-bg-elevated text-text-primary shadow-sm"
              : "text-text-tertiary"
          }`}
        >
          <Rows2 size={11} />
          Unified
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("split")}
          className={`flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            viewMode === "split"
              ? "bg-bg-elevated text-text-primary shadow-sm"
              : "text-text-tertiary"
          }`}
        >
          <Columns2 size={11} />
          Split
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("full-file")}
          className={`flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] transition-colors ${
            viewMode === "full-file" ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-tertiary"
          }`}
        >
          <FileText size={11} />
          Full file
        </button>
      </div>

      {/* Viewed toggle — hidden in commit view */}
      {!hideReviewControls && (
        <>
          <div className="bg-border h-4 w-px" />

          <button
            type="button"
            onClick={onToggleViewed}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              isViewed
                ? "bg-accent-muted border-border-accent text-accent-text"
                : "border-border bg-bg-raised text-text-secondary hover:text-text-primary"
            }`}
          >
            {isViewed && (
              <Check
                size={11}
                className="text-accent-text"
              />
            )}
            Viewed
            <Kbd className="border-border bg-bg-raised text-text-ghost h-[14px] min-w-[14px] rounded-[2px] border px-1 font-mono text-[9px]">
              v
            </Kbd>
          </button>
        </>
      )}

      <div className="bg-border h-4 w-px" />

      {/* File nav */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentIndex === 0}
          className="border-border bg-bg-raised text-text-secondary hover:text-text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={13} />
        </button>
        <span className="text-text-tertiary font-mono text-[10px]">
          {totalFiles > 0 ? `${currentIndex + 1}/${totalFiles}` : "0/0"}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={currentIndex >= totalFiles - 1}
          className="border-border bg-bg-raised text-text-secondary hover:text-text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
