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
// PR Activity State
// ---------------------------------------------------------------------------

export interface PrActivityState {
  repo: string;
  prNumber: number;
  lastSeenUpdatedAt: string;
  seenAt: string;
}

export function getPrActivityStates(): PrActivityState[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT repo, pr_number, last_seen_updated_at, seen_at
      FROM pr_activity_state
    `)
    .all() as Array<{
    repo: string;
    pr_number: number;
    last_seen_updated_at: string;
    seen_at: string;
  }>;

  return rows.map((row) => ({
    repo: row.repo,
    prNumber: row.pr_number,
    lastSeenUpdatedAt: row.last_seen_updated_at,
    seenAt: row.seen_at,
  }));
}

export function markPrActivitySeen(repo: string, prNumber: number, updatedAt: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO pr_activity_state (repo, pr_number, last_seen_updated_at, seen_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(repo, pr_number) DO UPDATE SET
      last_seen_updated_at = excluded.last_seen_updated_at,
      seen_at = excluded.seen_at
  `).run(repo, prNumber, updatedAt);
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

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

type NotificationType = "review" | "ci-fail" | "approve" | "merge";

export function getNotifications(limit = 50): Array<{
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  prNumber: number;
  workspace: string;
  read: boolean;
  createdAt: string;
}> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{
    id: number;
    type: string;
    title: string;
    body: string;
    pr_number: number | null;
    workspace: string | null;
    read: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    prNumber: r.pr_number ?? 0,
    workspace: r.workspace ?? "",
    read: r.read === 1,
    createdAt: r.created_at,
  }));
}

export function insertNotification(args: {
  type: string;
  title: string;
  body: string;
  prNumber: number;
  workspace: string;
}): void {
  const db = getDatabase();
  db.prepare(
    "INSERT INTO notifications (type, title, body, pr_number, workspace) VALUES (?, ?, ?, ?, ?)",
  ).run(args.type, args.title, args.body, args.prNumber, args.workspace);
}

export function markNotificationRead(id: number): void {
  const db = getDatabase();
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
}

export function markAllNotificationsRead(): void {
  const db = getDatabase();
  db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
}
