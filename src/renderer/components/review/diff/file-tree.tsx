import { toastManager } from "@/components/ui/toast";
import { openExternal } from "@/renderer/lib/app/open-external";
import { getDiffFilePath, type DiffFile } from "@/renderer/lib/review/diff-parser";
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function getNodeChildren(node: TreeNode): TreeNode[] {
  node.children ??= [];
  return node.children;
}

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

function sortNodes(nodes: TreeNode[]): void {
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

function buildTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  function ensureDirectory(dirPath: string): TreeNode {
    const existing = dirMap.get(dirPath);
    if (existing) {
      return existing;
    }

    const parts = dirPath.split("/");
    const name = parts.at(-1) ?? dirPath;
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
      getNodeChildren(parent).push(node);
    } else {
      root.push(node);
    }

    return node;
  }

  for (const [i, file] of files.entries()) {
    const filePath = getDiffFilePath(file);
    const parts = filePath.split("/");
    const name = parts.at(-1) ?? filePath;

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
      getNodeChildren(parent).push(node);
    } else {
      root.push(node);
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

/** Build a flat list of visible nodes for keyboard traversal (respects collapsed dirs). */
function getVisibleNodes(nodes: TreeNode[], expandedPaths: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.type === "dir" && expandedPaths.has(node.path) && node.children) {
      result.push(...getVisibleNodes(node.children, expandedPaths));
    }
  }
  return result;
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
    case "added": {
      return FilePlus2;
    }
    case "deleted": {
      return FileX2;
    }
    case "modified": {
      return FileEdit;
    }
    default: {
      return FileText;
    }
  }
}

function getStatusColor(status?: string): string {
  switch (status) {
    case "added": {
      return "text-success";
    }
    case "deleted": {
      return "text-destructive";
    }
    case "modified": {
      return "text-warning";
    }
    case "renamed": {
      return "text-info";
    }
    default: {
      return "text-text-ghost";
    }
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
  onSetFilesViewed?: (filePaths: string[], viewed: boolean) => void;
  commentCounts?: Map<string, number>;
  nwo: string;
  prNumber: number;
}

export function FileTree({
  files,
  currentFileIndex,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
  onSetFilesViewed,
  commentCounts = new Map(),
  nwo,
  prNumber,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const canToggleViewed = Boolean(onToggleViewed || onSetFilesViewed);

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

  const setFilesViewed = useCallback(
    (filePaths: string[], viewed: boolean) => {
      if (filePaths.length === 0) {
        return;
      }

      if (onSetFilesViewed) {
        onSetFilesViewed(filePaths, viewed);
        return;
      }

      for (const filePath of filePaths) {
        onToggleViewed?.(filePath, viewed);
      }
    },
    [onSetFilesViewed, onToggleViewed],
  );

  const setFileViewed = useCallback(
    (filePath: string, viewed: boolean) => {
      if (onToggleViewed) {
        onToggleViewed(filePath, viewed);
        return;
      }

      setFilesViewed([filePath], viewed);
    },
    [onToggleViewed, setFilesViewed],
  );

  const repoSlug = nwo;
  const toggleViewedHandler = canToggleViewed ? setFileViewed : undefined;
  const setFilesViewedHandler = canToggleViewed ? setFilesViewed : undefined;

  const visibleNodes = useMemo(() => getVisibleNodes(tree, expandedPaths), [tree, expandedPaths]);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleNodes.length === 0) {
        return;
      }

      const focusVisibleNode = (index: number) => {
        const node = visibleNodes.at(index);
        if (!node) {
          return;
        }

        setFocusedPath(node.path);
        treeContainerRef.current
          ?.querySelector(`[data-tree-path="${CSS.escape(node.path)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      };

      const currentIndex = focusedPath ? visibleNodes.findIndex((n) => n.path === focusedPath) : -1;
      const current = currentIndex >= 0 ? visibleNodes[currentIndex] : null;
      const focusParentDirectory = () => {
        if (currentIndex <= 0) {
          return;
        }

        const parts = (current?.path ?? "").split("/");
        if (parts.length <= 1) {
          return;
        }

        const parentPath = parts.slice(0, -1).join("/");
        const parentIdx = visibleNodes.findIndex((node) => node.path === parentPath);
        const parentNode = parentIdx === -1 ? undefined : visibleNodes.at(parentIdx);
        if (parentNode) {
          setFocusedPath(parentNode.path);
        }
      };

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, visibleNodes.length - 1);
          focusVisibleNode(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(currentIndex <= 0 ? 0 : currentIndex - 1, 0);
          focusVisibleNode(prev);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (current?.type === "dir" && !expandedPaths.has(current.path)) {
            toggleExpand(current.path);
          } else if (current?.type === "dir" && current.children?.length) {
            // Already expanded — move focus to first child
            const [firstChild] = current.children;
            if (firstChild) {
              setFocusedPath(firstChild.path);
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (current?.type === "dir" && expandedPaths.has(current.path)) {
            toggleExpand(current.path);
          } else {
            // Move to parent dir (find nearest ancestor dir)
            focusParentDirectory();
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (current?.type === "file" && current.fileIndex !== undefined) {
            selectFile(current.fileIndex);
          } else if (current?.type === "dir") {
            toggleExpand(current.path);
          }
          break;
        }
        default: {
          break;
        }
      }
    },
    [visibleNodes, focusedPath, expandedPaths, toggleExpand, selectFile],
  );

  return (
    <div className="flex flex-col">
      {/* Progress bar — hidden when viewed tracking is disabled */}
      {canToggleViewed && (
        <div className="flex items-center gap-2 px-3 pt-1 pb-2">
          <div className="bg-border h-[3px] flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: files.length > 0 ? `${(viewedCount / files.length) * 100}%` : "0%" }}
            />
          </div>
          <span className="text-text-tertiary font-mono text-[10px]">
            {viewedCount}/{files.length} viewed
          </span>
        </div>
      )}

      {/* Tree — keyboard navigable */}
      <div
        ref={treeContainerRef}
        data-review-focus-target="file-tree"
        className="focus:ring-border-accent/70 flex flex-col rounded-md focus:ring-1 focus:outline-none focus:ring-inset"
        tabIndex={0}
        role="tree"
        onKeyDown={handleTreeKeyDown}
        onFocus={() => {
          if (!focusedPath && visibleNodes.length > 0) {
            const [firstNode] = visibleNodes;
            if (firstNode) {
              setFocusedPath(firstNode.path);
            }
          }
        }}
      >
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
            onToggleViewed={toggleViewedHandler}
            onSetFilesViewed={setFilesViewedHandler}
            commentCounts={commentCounts}
            onContextMenu={handleContextMenu}
            focusedPath={focusedPath}
          />
        ))}
      </div>

      {contextMenu && (
        <FileTreeContextMenu
          node={contextMenu.node}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          viewedFiles={viewedFiles}
          onToggleViewed={toggleViewedHandler}
          onSetFilesViewed={setFilesViewedHandler}
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
  onSetFilesViewed,
  commentCounts,
  onContextMenu,
  focusedPath,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (index: number) => void;
  currentFileIndex: number;
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  onSetFilesViewed?: (filePaths: string[], viewed: boolean) => void;
  commentCounts: Map<string, number>;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  focusedPath?: string | null;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const paddingLeft = depth * 16 + 8;
  const canToggleViewed = Boolean(onToggleViewed || onSetFilesViewed);

  if (node.type === "dir") {
    const filePaths = getAllFilePaths(node);
    const viewedCount = filePaths.filter((filePath) => viewedFiles.has(filePath)).length;
    const allViewed = filePaths.length > 0 && viewedCount === filePaths.length;
    const partiallyViewed = viewedCount > 0 && viewedCount < filePaths.length;

    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          data-tree-path={node.path}
          className={`group hover:bg-bg-raised relative flex w-full cursor-pointer items-center gap-1 py-1.5 pr-2 text-left transition-colors ${
            allViewed ? "opacity-70" : ""
          } ${focusedPath === node.path ? "ring-primary/50 ring-1 ring-inset" : ""}`}
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
            <span
              className={`text-success font-mono text-[9px] ${canToggleViewed ? "group-hover:hidden" : ""}`}
            >
              +{node.additions}
            </span>
          )}
          {node.deletions > 0 && (
            <span
              className={`text-destructive font-mono text-[9px] ${
                canToggleViewed ? "group-hover:hidden" : ""
              }`}
            >
              -{node.deletions}
            </span>
          )}
          {canToggleViewed && (
            <ViewedCheckbox
              checkedState={allViewed ? "checked" : partiallyViewed ? "mixed" : "unchecked"}
              ariaLabel={`Mark folder ${node.path} as ${allViewed ? "unviewed" : "viewed"}`}
              title={allViewed ? "Mark all as unviewed" : "Mark all as viewed"}
              className="hidden group-hover:flex"
              onToggle={() => {
                if (filePaths.length === 0) {
                  return;
                }

                if (onSetFilesViewed) {
                  onSetFilesViewed(filePaths, !allViewed);
                  return;
                }

                for (const filePath of filePaths) {
                  onToggleViewed?.(filePath, !allViewed);
                }
              }}
            />
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
                onSetFilesViewed={onSetFilesViewed}
                commentCounts={commentCounts}
                onContextMenu={onContextMenu}
                focusedPath={focusedPath}
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
        data-tree-path={node.path}
        className={`group relative flex w-full cursor-pointer items-center gap-1.5 py-1.5 pr-2 text-left transition-colors ${
          isActive ? "bg-accent-muted" : "hover:bg-bg-raised"
        } ${focusedPath === node.path && !isActive ? "ring-primary/50 ring-1 ring-inset" : ""}`}
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
        <span className={`flex items-center gap-1 ${canToggleViewed ? "group-hover:hidden" : ""}`}>
          {node.additions > 0 && (
            <span className="text-success font-mono text-[9px]">+{node.additions}</span>
          )}
          {node.deletions > 0 && (
            <span className="text-destructive font-mono text-[9px]">-{node.deletions}</span>
          )}
        </span>

        {/* Viewed checkbox — appears on hover (only when onToggleViewed is provided) */}
        {onToggleViewed && (
          <ViewedCheckbox
            checkedState={isViewed ? "checked" : "unchecked"}
            ariaLabel={`Mark file ${node.path} as ${isViewed ? "unviewed" : "viewed"}`}
            title={isViewed ? "Mark as unviewed" : "Mark as viewed"}
            className="hidden group-hover:flex"
            onToggle={() => {
              onToggleViewed(node.path, !isViewed);
            }}
          />
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
  onSetFilesViewed,
  repoSlug,
  prNumber,
}: {
  node: TreeNode;
  position: { x: number; y: number };
  onClose: () => void;
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string, viewed: boolean) => void;
  onSetFilesViewed?: (filePaths: string[], viewed: boolean) => void;
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
                if (onSetFilesViewed) {
                  onSetFilesViewed(filePaths, false);
                } else {
                  for (const p of filePaths) {
                    onToggleViewed(p, false);
                  }
                }
                onClose();
              }}
            />
          ) : (
            <ContextMenuItem
              icon={<CheckCheck size={12} />}
              label="Mark all as viewed"
              onClick={() => {
                if (onSetFilesViewed) {
                  onSetFilesViewed(filePaths, true);
                } else {
                  for (const p of filePaths) {
                    onToggleViewed(p, true);
                  }
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

function ViewedCheckbox({
  checkedState,
  ariaLabel,
  title,
  className,
  onToggle,
}: {
  checkedState: "checked" | "mixed" | "unchecked";
  ariaLabel: string;
  title: string;
  className?: string;
  onToggle: () => void;
}) {
  const isChecked = checkedState === "checked";
  const isMixed = checkedState === "mixed";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isMixed ? "mixed" : isChecked}
      aria-label={ariaLabel}
      title={title}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }
      }}
      className={`h-[13px] w-[13px] shrink-0 cursor-pointer items-center justify-center rounded-xs border ${
        className ?? ""
      } ${
        isChecked
          ? "border-success bg-success text-bg-root"
          : isMixed
            ? "border-success bg-success/15 text-success"
            : "border-border-strong hover:border-text-tertiary text-transparent"
      }`}
    >
      {isChecked ? (
        <Check size={9} />
      ) : isMixed ? (
        <span className="h-[5px] w-[5px] rounded-[1px] bg-current" />
      ) : (
        <span className="h-[5px] w-[5px] opacity-0" />
      )}
    </button>
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
