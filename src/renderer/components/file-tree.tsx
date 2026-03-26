import { toastManager } from "@/components/ui/toast";
import {
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileEdit,
  FilePlus2,
  FileText,
  FileX2,
  MessageCircle,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getDiffFilePath, type DiffFile } from "../lib/diff-parser";
import { openExternal } from "../lib/open-external";

/**
 * Hierarchical file tree — inspired by Better Hub's diff-file-tree.
 *
 * Features:
 * - Lazy recursive directory creation from flat file list
 * - Collapsible directories with smooth CSS grid animation
 * - Depth-based indent guides
 * - File status icons (added/modified/deleted/renamed)
 * - Directory-level aggregated +/- stats
 * - Per-file comment count badges
 * - Viewed state with checkboxes
 * - Progress bar header
 */

// ---------------------------------------------------------------------------
// Tree data structure
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  status?: string;
  additions: number;
  deletions: number;
  fileIndex?: number;
  children?: TreeNode[];
}

function buildTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  function ensureDirectory(dirPath: string): TreeNode {
    const existing = dirMap.get(dirPath);
    if (existing) {
      return existing;
    }

    const parts = dirPath.split("/");
    const name = parts[parts.length - 1] ?? dirPath;
    const node: TreeNode = {
      name,
      path: dirPath,
      type: "dir",
      additions: 0,
      deletions: 0,
      children: [],
    };
    dirMap.set(dirPath, node);

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureDirectory(parentPath);
      parent.children!.push(node);
    } else {
      root.push(node);
    }

    return node;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const filePath = getDiffFilePath(file);
    const parts = filePath.split("/");
    const name = parts[parts.length - 1] ?? filePath;

    const node: TreeNode = {
      name,
      path: filePath,
      type: "file",
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      fileIndex: i,
    };

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureDirectory(parentPath);
      parent.children!.push(node);
    } else {
      root.push(node);
    }
  }

  // Aggregate stats
  function aggregateStats(node: TreeNode): { additions: number; deletions: number } {
    if (node.type === "file") {
      return { additions: node.additions, deletions: node.deletions };
    }
    let additions = 0;
    let deletions = 0;
    for (const child of node.children ?? []) {
      const stats = aggregateStats(child);
      additions += stats.additions;
      deletions += stats.deletions;
    }
    node.additions = additions;
    node.deletions = deletions;
    return { additions, deletions };
  }

  // Sort: directories first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  }

  for (const node of root) {
    aggregateStats(node);
  }
  sortNodes(root);

  return root;
}

function getAllDirPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === "dir") {
      paths.push(node.path);
      if (node.children) {
        paths.push(...getAllDirPaths(node.children));
      }
    }
  }
  return paths;
}

function getAllFilePaths(node: TreeNode): string[] {
  if (node.type === "file") {
    return [node.path];
  }
  const paths: string[] = [];
  for (const child of node.children ?? []) {
    paths.push(...getAllFilePaths(child));
  }
  return paths;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

// ---------------------------------------------------------------------------
// File status helpers
// ---------------------------------------------------------------------------

function getStatusIcon(status?: string) {
  switch (status) {
    case "added":
      return FilePlus2;
    case "deleted":
      return FileX2;
    case "modified":
      return FileEdit;
    default:
      return FileText;
  }
}

function getStatusColor(status?: string): string {
  switch (status) {
    case "added":
      return "text-success";
    case "deleted":
      return "text-destructive";
    case "modified":
      return "text-warning";
    case "renamed":
      return "text-info";
    default:
      return "text-text-ghost";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FileTreeProps {
  files: DiffFile[];
  currentFileIndex: number;
  onSelectFile: (index: number) => void;
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  commentCounts?: Map<string, number>;
  cwd: string;
  prNumber: number;
}

export function FileTree({
  files,
  currentFileIndex,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
  commentCounts = new Map(),
  cwd,
  prNumber,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const initializedRef = useRef(false);

  // Expand all directories on first render (render-time state adjustment)
  if (!initializedRef.current && tree.length > 0) {
    initializedRef.current = true;
    setExpandedPaths(new Set(getAllDirPaths(tree)));
  }

  const viewedCount = files.filter((f) => viewedFiles.has(getDiffFilePath(f))).length;

  function toggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  // Auto-expand ancestors when selecting a file
  function selectFile(index: number) {
    const file = files[index];
    if (file) {
      const filePath = getDiffFilePath(file);
      const parts = filePath.split("/");
      if (parts.length > 1) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          for (let i = 1; i < parts.length; i++) {
            next.add(parts.slice(0, i).join("/"));
          }
          return next;
        });
      }
    }
    onSelectFile(index);
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const repoSlug = cwd.split("/").slice(-2).join("/");

  return (
    <div className="flex flex-col">
      {/* Progress bar — hidden when viewed tracking is disabled */}
      {onToggleViewed && (
        <div className="flex items-center gap-2 px-3 pt-1 pb-2">
          <div className="bg-border h-[3px] flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: files.length > 0 ? `${(viewedCount / files.length) * 100}%` : "0%" }}
            />
          </div>
          <span className="text-text-tertiary font-mono text-[10px]">
            {viewedCount}/{files.length} viewed
          </span>
        </div>
      )}

      {/* Tree */}
      <div className="flex flex-col">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            onToggle={toggleExpand}
            onSelectFile={selectFile}
            currentFileIndex={currentFileIndex}
            viewedFiles={viewedFiles}
            onToggleViewed={onToggleViewed}
            commentCounts={commentCounts}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {contextMenu && (
        <FileTreeContextMenu
          node={contextMenu.node}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          viewedFiles={viewedFiles}
          onToggleViewed={onToggleViewed}
          repoSlug={repoSlug}
          prNumber={prNumber}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree node row (recursive)
// ---------------------------------------------------------------------------

function TreeNodeRow({
  node,
  depth,
  expandedPaths,
  onToggle,
  onSelectFile,
  currentFileIndex,
  viewedFiles,
  onToggleViewed,
  commentCounts,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (index: number) => void;
  currentFileIndex: number;
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  commentCounts: Map<string, number>;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const paddingLeft = depth * 16 + 8;

  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="group hover:bg-bg-raised relative flex w-full cursor-pointer items-center gap-1 py-1 pr-2 text-left transition-colors"
          style={{ paddingLeft }}
        >
          {/* Indent guides */}
          {Array.from({ length: depth }, (_, i) => (
            <span
              key={i}
              className="bg-border/60 absolute top-0 bottom-0 w-px"
              style={{ left: i * 16 + 16 }}
            />
          ))}

          <ChevronRight
            size={12}
            className={`text-text-tertiary shrink-0 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          <span className="text-text-primary flex-1 truncate text-[11px] font-medium">
            {node.name}
          </span>
          {node.additions > 0 && (
            <span className="text-success font-mono text-[9px]">+{node.additions}</span>
          )}
          {node.deletions > 0 && (
            <span className="text-destructive font-mono text-[9px]">-{node.deletions}</span>
          )}
        </button>
        {/* Animated collapse container */}
        <div
          className="grid transition-[grid-template-rows] duration-150 ease-out"
          style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            {node.children?.map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
                currentFileIndex={currentFileIndex}
                viewedFiles={viewedFiles}
                onToggleViewed={onToggleViewed}
                commentCounts={commentCounts}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // File node
  const isActive = currentFileIndex === node.fileIndex;
  const isViewed = viewedFiles.has(node.path);
  const StatusIcon = isViewed ? Check : getStatusIcon(node.status);
  const statusColor = isViewed ? "text-primary" : getStatusColor(node.status);
  const commentCount = commentCounts.get(node.path) ?? 0;

  return (
    <div className="relative">
      {/* Indent guides */}
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="bg-border/60 absolute top-0 bottom-0 w-px"
          style={{ left: i * 16 + 16 }}
        />
      ))}

      <button
        type="button"
        onClick={() => node.fileIndex !== undefined && onSelectFile(node.fileIndex)}
        onContextMenu={(e) => onContextMenu(e, node)}
        className={`group relative flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-left transition-colors ${
          isActive ? "bg-accent-muted" : "hover:bg-bg-raised"
        }`}
        style={{ paddingLeft: paddingLeft + 15 }}
      >
        {/* Active indicator */}
        {isActive && (
          <div className="bg-primary absolute top-1 bottom-1 left-0 w-[2px] rounded-r-full" />
        )}

        <StatusIcon
          size={13}
          className={`shrink-0 ${statusColor}`}
        />

        <span
          className={`flex-1 truncate font-mono text-[11px] ${
            isViewed ? "text-text-tertiary line-through opacity-60" : "text-text-primary"
          }`}
        >
          {node.name}
        </span>

        {/* Comment badge */}
        {commentCount > 0 && (
          <span className="text-warning flex items-center gap-0.5 font-mono text-[9px]">
            <MessageCircle size={9} />
            {commentCount}
          </span>
        )}

        {/* Stats (hidden on hover, replaced by viewed checkbox) */}
        <span className="flex items-center gap-1 group-hover:hidden">
          {node.additions > 0 && (
            <span className="text-success font-mono text-[9px]">+{node.additions}</span>
          )}
          {node.deletions > 0 && (
            <span className="text-destructive font-mono text-[9px]">-{node.deletions}</span>
          )}
        </span>

        {/* Viewed checkbox — appears on hover (only when onToggleViewed is provided) */}
        {onToggleViewed && (
          <span
            role="checkbox"
            aria-checked={isViewed}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleViewed(node.path, !isViewed);
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.stopPropagation();
                e.preventDefault();
                onToggleViewed(node.path, !isViewed);
              }
            }}
            className={`hidden h-[13px] w-[13px] shrink-0 cursor-pointer items-center justify-center rounded-xs border group-hover:flex ${
              isViewed
                ? "border-success bg-success text-bg-root"
                : "border-border-strong hover:border-text-tertiary text-transparent"
            }`}
          >
            {isViewed ? (
              <Check size={9} />
            ) : (
              <Square
                size={9}
                className="opacity-0"
              />
            )}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function FileTreeContextMenu({
  node,
  position,
  onClose,
  viewedFiles,
  onToggleViewed,
  repoSlug,
  prNumber,
}: {
  node: TreeNode;
  position: { x: number; y: number };
  onClose: () => void;
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  repoSlug: string;
  prNumber: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClick, handleEscape]);

  if (node.type === "dir") {
    const filePaths = getAllFilePaths(node);
    const allViewed = filePaths.length > 0 && filePaths.every((p) => viewedFiles.has(p));

    return (
      <div
        ref={menuRef}
        className="border-border bg-bg-elevated fixed z-50 rounded-md border p-1 shadow-lg"
        style={{ left: position.x, top: position.y }}
      >
        {onToggleViewed &&
          (allViewed ? (
            <ContextMenuItem
              icon={<EyeOff size={12} />}
              label="Mark all as unviewed"
              onClick={() => {
                for (const p of filePaths) {
                  onToggleViewed(p, false);
                }
                onClose();
              }}
            />
          ) : (
            <ContextMenuItem
              icon={<CheckCheck size={12} />}
              label="Mark all as viewed"
              onClick={() => {
                for (const p of filePaths) {
                  onToggleViewed(p, true);
                }
                onClose();
              }}
            />
          ))}
        <ContextMenuItem
          icon={<Copy size={12} />}
          label="Copy path"
          onClick={() => {
            navigator.clipboard.writeText(node.path);
            toastManager.add({ title: "Path copied", type: "success" });
            onClose();
          }}
        />
      </div>
    );
  }

  // File context menu
  const isViewed = viewedFiles.has(node.path);
  const githubFileUrl = `https://github.com/${repoSlug}/pull/${prNumber}/files#diff-${node.path}`;

  return (
    <div
      ref={menuRef}
      className="border-border bg-bg-elevated fixed z-50 rounded-md border p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {onToggleViewed && (
        <ContextMenuItem
          icon={isViewed ? <EyeOff size={12} /> : <Eye size={12} />}
          label={isViewed ? "Mark as unviewed" : "Mark as viewed"}
          onClick={() => {
            onToggleViewed(node.path, !isViewed);
            onClose();
          }}
        />
      )}
      <div style={{ height: "1px", background: "var(--border)", margin: "2px 0" }} />
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy file path"
        onClick={() => {
          navigator.clipboard.writeText(node.path);
          toastManager.add({ title: "Path copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy GitHub URL"
        onClick={() => {
          navigator.clipboard.writeText(githubFileUrl);
          toastManager.add({ title: "URL copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<ExternalLink size={12} />}
        label="Open on GitHub"
        onClick={() => {
          void openExternal(githubFileUrl);
          onClose();
        }}
      />
    </div>
  );
}

function ContextMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs"
    >
      {icon}
      {label}
    </button>
  );
}
