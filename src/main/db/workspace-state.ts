import { existsSync } from "node:fs";

interface WorkspacePathLike {
  path: string | null;
}

export function splitWorkspaceRows<TRow extends WorkspacePathLike>(
  rows: TRow[],
  pathExists: (path: string) => boolean = existsSync,
): { validRows: TRow[]; staleRows: TRow[] } {
  const validRows: TRow[] = [];
  const staleRows: TRow[] = [];

  for (const row of rows) {
    // Remote-only workspaces (no path) are always valid
    if (!row.path || pathExists(row.path)) {
      validRows.push(row);
    } else {
      staleRows.push(row);
    }
  }

  return { staleRows, validRows };
}
