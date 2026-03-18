import type { DiffFile } from "../lib/diff-parser";

import { Check, Square } from "lucide-react";
import { useMemo } from "react";

/**
 * File tree sidebar — DISPATCH-DESIGN-SYSTEM.md § 8.7 (Files tab)
 *
 * Flat list of changed files with viewed state + navigation.
 */

interface FileTreeProps {
  files: DiffFile[];
  currentFileIndex: number;
  onSelectFile: (index: number) => void;
  viewedFiles: Set<string>;
  onToggleViewed: (filePath: string, viewed: boolean) => void;
}

const STATUS_DOT_COLOR: Record<string, string> = {
  added: "bg-success",
  deleted: "bg-destructive",
  modified: "bg-warning",
  renamed: "bg-info",
};

export function FileTree({
  files,
  currentFileIndex,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
}: FileTreeProps) {
  const viewedCount = files.filter((f) => viewedFiles.has(f.newPath)).length;

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const aPath = a.newPath || a.oldPath;
      const bPath = b.newPath || b.oldPath;
      const aDir = aPath.includes("/") ? aPath.slice(0, aPath.lastIndexOf("/")) : "";
      const bDir = bPath.includes("/") ? bPath.slice(0, bPath.lastIndexOf("/")) : "";
      if (aDir !== bDir) {
        return aDir.localeCompare(bDir);
      }
      const aName = aPath.split("/").pop() ?? aPath;
      const bName = bPath.split("/").pop() ?? bPath;
      return aName.localeCompare(bName);
    });
  }, [files]);

  return (
    <div className="flex flex-col">
      {/* Progress */}
      <div className="flex items-center gap-2 px-3 pt-1 pb-2">
        <div className="bg-border h-[3px] flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: files.length > 0 ? `${(viewedCount / files.length) * 100}%` : "0%" }}
          />
        </div>
        <span className="text-text-tertiary font-mono text-[10px]">
          {viewedCount}/{files.length}
        </span>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-0.5">
        {sortedFiles.map((file) => {
          const originalIndex = files.indexOf(file);
          const filePath = file.newPath || file.oldPath;
          const fileName = filePath.split("/").pop() ?? filePath;
          const dirPath = filePath.includes("/")
            ? filePath.slice(0, filePath.lastIndexOf("/"))
            : "";
          const isViewed = viewedFiles.has(filePath);
          const isActive = currentFileIndex === originalIndex;

          return (
            <button
              key={filePath}
              type="button"
              onClick={() => onSelectFile(originalIndex)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? "border-l-primary bg-accent-muted border-l-2"
                  : "hover:bg-bg-raised border-l-2 border-l-transparent"
              }`}
            >
              {/* Viewed checkbox */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleViewed(filePath, !isViewed);
                }}
                className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-xs border ${
                  isViewed
                    ? "border-success bg-success text-bg-root"
                    : "border-border-strong hover:border-text-tertiary text-transparent"
                }`}
              >
                {isViewed ? (
                  <Check size={10} />
                ) : (
                  <Square
                    size={10}
                    className="opacity-0"
                  />
                )}
              </button>

              {/* Status dot */}
              <div
                className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                  STATUS_DOT_COLOR[file.status] ?? "bg-text-ghost"
                }`}
              />

              {/* File path */}
              <div className="min-w-0 flex-1">
                {dirPath && (
                  <p className="text-text-tertiary truncate font-mono text-[10px]">{dirPath}/</p>
                )}
                <p className="text-text-primary truncate font-mono text-xs">{fileName}</p>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-1">
                {file.additions > 0 && (
                  <span className="text-success font-mono text-[10px]">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-destructive font-mono text-[10px]">-{file.deletions}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
