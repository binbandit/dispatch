import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Review State (Incremental Diff)
// ---------------------------------------------------------------------------

export function getLastReviewedSha(repo: string, prNumber: number): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT last_sha FROM review_state WHERE repo = ? AND pr_number = ?")
    .get(repo, prNumber) as { last_sha: string } | undefined;
  return row?.last_sha ?? null;
}

export function saveReviewedSha(repo: string, prNumber: number, sha: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO review_state (repo, pr_number, last_sha, reviewed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(repo, pr_number) DO UPDATE SET last_sha = excluded.last_sha, reviewed_at = excluded.reviewed_at
  `).run(repo, prNumber, sha);
}

// ---------------------------------------------------------------------------
// Viewed Files
// ---------------------------------------------------------------------------

export function getViewedFiles(repo: string, prNumber: number): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT file_path FROM viewed_files WHERE repo = ? AND pr_number = ? AND viewed = 1")
    .all(repo, prNumber) as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

export function setFileViewed(
  repo: string,
  prNumber: number,
  filePath: string,
  viewed: boolean,
): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO viewed_files (repo, pr_number, file_path, viewed)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(repo, pr_number, file_path) DO UPDATE SET viewed = excluded.viewed
  `).run(repo, prNumber, filePath, viewed ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function getPreference(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM preferences WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setPreference(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO preferences (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export function addWorkspace(path: string, name: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO workspaces (path, name, added_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(path) DO NOTHING
  `).run(path, name);
}

export function getWorkspaces(): Array<{
  id: number;
  path: string;
  name: string;
  addedAt: string;
}> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT id, path, name, added_at FROM workspaces ORDER BY added_at DESC")
    .all() as Array<{ id: number; path: string; name: string; added_at: string }>;
  return rows.map((r) => ({ id: r.id, path: r.path, name: r.name, addedAt: r.added_at }));
}

export function removeWorkspace(id: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

export function getActiveWorkspace(): string | null {
  return getPreference("activeWorkspace");
}

export function setActiveWorkspace(path: string): void {
  setPreference("activeWorkspace", path);
}
