import type { DiffMode } from "@/renderer/components/review/diff/diff-viewer";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getDiffFilePath, type DiffFile } from "@/renderer/lib/review/diff-parser";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  FileText,
  Rows2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Diff toolbar — PR-REVIEW-REDESIGN.md § Diff Toolbar (32px)
 *
 * File path (mono, dir dimmed), "Since review" callout,
 * Unified/Split toggle, AI Review button, Viewed toggle with `v` kbd hint, file nav.
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
  onAiSuggest,
  isAiSuggesting,
  aiSuggestEnabled,
  isFullFileLoading = false,
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
  onAiSuggest?: () => void;
  isAiSuggesting?: boolean;
  aiSuggestEnabled?: boolean;
  isFullFileLoading?: boolean;
}) {
  const compressedPathToolbar = useMediaQuery({ max: 1320 });
  const compactToolbar = useMediaQuery({ max: 1100 });
  const denseToolbar = useMediaQuery({ max: 920 });
  const controlsLocked = isFullFileLoading;
  const filePath = currentFile ? getDiffFilePath(currentFile) : "";
  const fileName = filePath.split("/").pop() ?? "";
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
  const displayDirPath = denseToolbar
    ? ""
    : compressedPathToolbar
      ? getCondensedDirPath(dirPath)
      : dirPath;
  const showIconOnlyControls = compactToolbar;

  // Brief tick when AI review finishes — confirms it ran even if no comments added
  const [aiJustFinished, setAiJustFinished] = useState(false);
  const prevAiSuggesting = useRef(false);
  useEffect(() => {
    if (prevAiSuggesting.current && !isAiSuggesting) {
      setAiJustFinished(true);
      const timer = setTimeout(() => setAiJustFinished(false), 2000);
      return () => clearTimeout(timer);
    }
    prevAiSuggesting.current = Boolean(isAiSuggesting);
  }, [isAiSuggesting]);

  const viewedButton = (
    <button
      type="button"
      onClick={onToggleViewed}
      disabled={controlsLocked}
      title={denseToolbar ? (isViewed ? "Viewed" : "Mark file as viewed") : undefined}
      aria-label={isViewed ? "Viewed" : "Mark file as viewed"}
      className={`flex cursor-pointer items-center rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
        denseToolbar ? "gap-0" : "gap-1.5"
      } ${
        isViewed
          ? "bg-accent-muted border-border-accent text-accent-text"
          : "border-border bg-bg-raised text-text-secondary hover:text-text-primary"
      } disabled:cursor-default disabled:opacity-50`}
    >
      {denseToolbar ? (
        isViewed ? (
          <Check
            size={11}
            className="text-accent-text"
          />
        ) : (
          <Eye
            size={11}
            className="text-text-tertiary"
          />
        )
      ) : (
        <>
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
        </>
      )}
    </button>
  );

  return (
    <div
      aria-busy={controlsLocked || undefined}
      className="border-border-subtle bg-bg-surface flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b px-3"
    >
      {/* File path */}
      <div className="min-w-0 flex-1 basis-0 overflow-hidden">
        {filePath ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="text-text-tertiary block truncate font-mono text-[11px] font-medium">
                  {displayDirPath}
                  <span className="text-text-secondary">{fileName}</span>
                </span>
              }
            />
            <TooltipPopup className="max-w-96 font-mono text-[10px] break-all">
              {filePath}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span className="text-text-tertiary block truncate font-mono text-[11px] font-medium">
            <span className="text-text-secondary">{fileName}</span>
          </span>
        )}
      </div>

      {/* "Since review" callout — hidden in commit view */}
      {!hideReviewControls && hasLastReview && diffMode === "since-review" && (
        <span className="bg-purple-muted text-purple flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
          {compactToolbar ? "Review delta" : "Since last review"}
          <button
            type="button"
            onClick={() => onDiffModeChange("all")}
            disabled={controlsLocked}
            className="text-purple cursor-pointer text-[10px] hover:underline disabled:cursor-default disabled:opacity-50"
          >
            {denseToolbar ? "All" : "Show all"}
          </button>
        </span>
      )}

      {!hideReviewControls && hasLastReview && diffMode === "all" && (
        <button
          type="button"
          onClick={() => onDiffModeChange("since-review")}
          disabled={controlsLocked}
          className="text-purple hover:bg-purple-muted shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50"
        >
          Since review
        </button>
      )}

      {/* AI Review button */}
      {aiSuggestEnabled && onAiSuggest && !hideReviewControls && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onAiSuggest}
                disabled={controlsLocked || isAiSuggesting}
                aria-label="AI review"
                className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 ${
                  aiJustFinished ? "text-success" : "text-primary hover:bg-primary/10"
                }`}
              >
                {isAiSuggesting ? (
                  <Spinner className="h-3 w-3" />
                ) : aiJustFinished ? (
                  <Check size={11} />
                ) : (
                  <Sparkles size={11} />
                )}
                {!showIconOnlyControls && "AI Review"}
              </button>
            }
          />
          <TooltipPopup>
            Review this file with PR description and changed-file context. No whole-codebase scan.
          </TooltipPopup>
        </Tooltip>
      )}

      {/* View mode toggle: Unified / Split / Full file */}
      <div className="border-border bg-bg-raised flex shrink-0 items-center rounded-md border p-[2px]">
        <button
          type="button"
          onClick={() => onViewModeChange("unified")}
          disabled={controlsLocked}
          title={showIconOnlyControls ? "Unified diff" : undefined}
          aria-label="Unified diff"
          className={`flex cursor-pointer items-center rounded-sm px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors ${
            showIconOnlyControls ? "gap-0" : "gap-1"
          } ${
            viewMode === "unified"
              ? "bg-bg-elevated text-text-primary shadow-sm"
              : "text-text-tertiary"
          } disabled:cursor-default disabled:opacity-50`}
        >
          <Rows2 size={11} />
          {!showIconOnlyControls && "Unified"}
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("split")}
          disabled={controlsLocked}
          title={showIconOnlyControls ? "Split diff" : undefined}
          aria-label="Split diff"
          className={`flex cursor-pointer items-center rounded-sm px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors ${
            showIconOnlyControls ? "gap-0" : "gap-1"
          } ${
            viewMode === "split"
              ? "bg-bg-elevated text-text-primary shadow-sm"
              : "text-text-tertiary"
          } disabled:cursor-default disabled:opacity-50`}
        >
          <Columns2 size={11} />
          {!showIconOnlyControls && "Split"}
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("full-file")}
          disabled={controlsLocked}
          title={
            showIconOnlyControls
              ? isFullFileLoading
                ? "Loading full file"
                : "Full file"
              : undefined
          }
          aria-label={isFullFileLoading ? "Loading full file" : "Full file"}
          className={`flex cursor-pointer items-center rounded-sm px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors ${
            showIconOnlyControls ? "gap-0" : "gap-1"
          } ${
            viewMode === "full-file"
              ? "bg-bg-elevated text-text-primary shadow-sm"
              : isFullFileLoading
                ? "text-accent-text"
                : "text-text-tertiary"
          } disabled:cursor-default disabled:opacity-50`}
        >
          {isFullFileLoading ? <Spinner className="h-[11px] w-[11px]" /> : <FileText size={11} />}
          {!showIconOnlyControls && "Full file"}
        </button>
      </div>

      {/* Viewed toggle — hidden in commit view */}
      {!hideReviewControls && (
        <>
          <div className="bg-border h-4 w-px shrink-0" />

          {denseToolbar ? (
            <Tooltip>
              <TooltipTrigger render={viewedButton} />
              <TooltipPopup>{isViewed ? "Viewed" : "Mark viewed (v)"}</TooltipPopup>
            </Tooltip>
          ) : (
            viewedButton
          )}
        </>
      )}

      <div className="bg-border h-4 w-px shrink-0" />

      {/* File nav */}
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onPrev}
                disabled={controlsLocked || currentIndex === 0}
                aria-label="Previous file"
                className="border-border bg-bg-raised text-text-secondary hover:text-text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={13} />
              </button>
            }
          />
          <TooltipPopup>Previous file</TooltipPopup>
        </Tooltip>
        <span className="text-text-tertiary font-mono text-[10px]">
          {totalFiles > 0 ? `${currentIndex + 1}/${totalFiles}` : "0/0"}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onNext}
                disabled={controlsLocked || currentIndex >= totalFiles - 1}
                aria-label="Next file"
                className="border-border bg-bg-raised text-text-secondary hover:text-text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight size={13} />
              </button>
            }
          />
          <TooltipPopup>Next file</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

function getCondensedDirPath(dirPath: string): string {
  const segments = dirPath.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return dirPath;
  }

  return `.../${segments.slice(-2).join("/")}/`;
}
