import { existsSync } from "node:fs";

interface WorkspacePathLike {
  path: string;
}

export function splitWorkspaceRows<TRow extends WorkspacePathLike>(
  rows: TRow[],
  pathExists: (path: string) => boolean = existsSync,
): { validRows: TRow[]; staleRows: TRow[] } {
  const validRows: TRow[] = [];
  const staleRows: TRow[] = [];

  for (const row of rows) {
    if (pathExists(row.path)) {
      validRows.push(row);
    } else {
      staleRows.push(row);
    }
  }

  return { staleRows, validRows };
}

export function resolveActiveWorkspacePath<TRow extends WorkspacePathLike>(
  activeWorkspace: string | null,
  workspaces: TRow[],
  pathExists: (path: string) => boolean = existsSync,
): string | null {
  if (activeWorkspace && pathExists(activeWorkspace)) {
    return activeWorkspace;
  }

  return workspaces.find((workspace) => pathExists(workspace.path))?.path ?? null;
}
