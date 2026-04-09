import { existsSync } from "node:fs";

import { getDatabase } from "./database";
import { resolveActiveWorkspacePath, splitWorkspaceRows } from "./workspace-state";

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

/* eslint-disable-next-line max-params -- These sqlite helpers mirror the table key shape directly. */
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
// AI Review Summary Cache
// ---------------------------------------------------------------------------

export interface AiReviewSummaryCacheEntry {
  summary: string;
  confidenceScore: number | null;
  snapshotKey: string;
  generatedAt: string;
}

export interface AiTriageCacheEntry {
  payload: string;
  snapshotKey: string;
  generatedAt: string;
}

export function getAiReviewSummary(
  workspace: string,
  prNumber: number,
): AiReviewSummaryCacheEntry | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT summary, confidence_score, snapshot_key, generated_at
      FROM ai_review_summaries
      WHERE workspace = ? AND pr_number = ?
    `)
    .get(workspace, prNumber) as
    | {
        summary: string;
        confidence_score: number | null;
        snapshot_key: string;
        generated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    summary: row.summary,
    confidenceScore: row.confidence_score,
    snapshotKey: row.snapshot_key,
    generatedAt: row.generated_at,
  };
}

export function saveAiReviewSummary(entry: {
  workspace: string;
  prNumber: number;
  snapshotKey: string;
  summary: string;
  confidenceScore: number | null;
}): AiReviewSummaryCacheEntry {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO ai_review_summaries (workspace, pr_number, snapshot_key, summary, confidence_score, generated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace, pr_number) DO UPDATE SET
      snapshot_key = excluded.snapshot_key,
      summary = excluded.summary,
      confidence_score = excluded.confidence_score,
      generated_at = excluded.generated_at
  `).run(entry.workspace, entry.prNumber, entry.snapshotKey, entry.summary, entry.confidenceScore);

  const savedEntry = getAiReviewSummary(entry.workspace, entry.prNumber);
  if (!savedEntry) {
    throw new Error(`Failed to persist AI review summary for PR #${entry.prNumber}.`);
  }

  return savedEntry;
}

export function getAiTriage(workspace: string, prNumber: number): AiTriageCacheEntry | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT payload, snapshot_key, generated_at
      FROM ai_triage_groups
      WHERE workspace = ? AND pr_number = ?
    `)
    .get(workspace, prNumber) as
    | {
        payload: string;
        snapshot_key: string;
        generated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    payload: row.payload,
    snapshotKey: row.snapshot_key,
    generatedAt: row.generated_at,
  };
}

export function saveAiTriage(entry: {
  workspace: string;
  prNumber: number;
  snapshotKey: string;
  payload: string;
}): AiTriageCacheEntry {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO ai_triage_groups (workspace, pr_number, snapshot_key, payload, generated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace, pr_number) DO UPDATE SET
      snapshot_key = excluded.snapshot_key,
      payload = excluded.payload,
      generated_at = excluded.generated_at
  `).run(entry.workspace, entry.prNumber, entry.snapshotKey, entry.payload);

  const savedEntry = getAiTriage(entry.workspace, entry.prNumber);
  if (!savedEntry) {
    throw new Error(`Failed to persist AI triage groups for PR #${entry.prNumber}.`);
  }

  return savedEntry;
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

export function deletePreferences(keys: string[]): void {
  const db = getDatabase();
  const placeholders = keys.map(() => "?").join(", ");
  db.prepare(`DELETE FROM preferences WHERE key IN (${placeholders})`).run(...keys);
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

function workspaceExists(path: string): boolean {
  return path.length > 0 && existsSync(path);
}

function pruneMissingWorkspaces(): Array<{
  id: number;
  path: string;
  name: string;
  added_at: string;
}> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT id, path, name, added_at FROM workspaces ORDER BY added_at DESC")
    .all() as Array<{ id: number; path: string; name: string; added_at: string }>;

  const { staleRows, validRows } = splitWorkspaceRows(rows);

  if (staleRows.length === 0) {
    return validRows;
  }

  const staleIds = staleRows.map((row) => row.id);
  const stalePaths = staleRows.map((row) => row.path);
  const idPlaceholders = staleIds.map(() => "?").join(", ");
  const pathPlaceholders = stalePaths.map(() => "?").join(", ");

  db.prepare(`DELETE FROM workspaces WHERE id IN (${idPlaceholders})`).run(...staleIds);
  db.prepare(`DELETE FROM repo_accounts WHERE path IN (${pathPlaceholders})`).run(...stalePaths);

  const activeWorkspace = getPreference("activeWorkspace");
  if (activeWorkspace && stalePaths.includes(activeWorkspace)) {
    deletePreferences(["activeWorkspace"]);
  }

  return validRows;
}

export function getWorkspaces(): Array<{
  id: number;
  path: string;
  name: string;
  addedAt: string;
}> {
  const rows = pruneMissingWorkspaces();
  return rows.map((r) => ({ id: r.id, path: r.path, name: r.name, addedAt: r.added_at }));
}

export function removeWorkspace(id: number): void {
  const db = getDatabase();
  const row = db.prepare("SELECT path FROM workspaces WHERE id = ?").get(id) as
    | { path: string }
    | undefined;
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);

  if (!row) {
    return;
  }

  db.prepare("DELETE FROM repo_accounts WHERE path = ?").run(row.path);

  const activeWorkspace = getPreference("activeWorkspace");
  if (activeWorkspace === row.path) {
    deletePreferences(["activeWorkspace"]);
    const fallbackWorkspace = getWorkspaces()[0]?.path ?? null;
    if (fallbackWorkspace) {
      setPreference("activeWorkspace", fallbackWorkspace);
    }
  }
}

export function getActiveWorkspace(): string | null {
  const activeWorkspace = getPreference("activeWorkspace");
  const fallbackWorkspace = resolveActiveWorkspacePath(activeWorkspace, getWorkspaces());
  if (activeWorkspace && activeWorkspace !== fallbackWorkspace) {
    deletePreferences(["activeWorkspace"]);
  }
  if (fallbackWorkspace) {
    setPreference("activeWorkspace", fallbackWorkspace);
  }

  return fallbackWorkspace;
}

export function setActiveWorkspace(path: string): void {
  if (!workspaceExists(path)) {
    throw new Error(`Workspace path does not exist: ${path}`);
  }

  setPreference("activeWorkspace", path);
}

// ---------------------------------------------------------------------------
// Repo Accounts (per-repo GitHub account memory)
// ---------------------------------------------------------------------------

export function getRepoAccount(path: string): { host: string; login: string } | null {
  const db = getDatabase();
  const row = db.prepare("SELECT host, login FROM repo_accounts WHERE path = ?").get(path) as
    | { host: string; login: string }
    | undefined;
  return row ?? null;
}

export function setRepoAccount(path: string, host: string, login: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO repo_accounts (path, host, login) VALUES (?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET host = excluded.host, login = excluded.login
  `).run(path, host, login);
}

// ---------------------------------------------------------------------------
// Minimized Comments
// ---------------------------------------------------------------------------

export function getMinimizedComments(repo: string, prNumber: number): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT comment_id FROM minimized_comments WHERE repo = ? AND pr_number = ?")
    .all(repo, prNumber) as Array<{ comment_id: string }>;
  return rows.map((r) => r.comment_id);
}

/* eslint-disable-next-line max-params -- These sqlite helpers mirror the table key shape directly. */
export function setCommentMinimized(
  repo: string,
  prNumber: number,
  commentId: string,
  minimized: boolean,
): void {
  const db = getDatabase();
  if (minimized) {
    db.prepare(`
      INSERT INTO minimized_comments (repo, pr_number, comment_id)
      VALUES (?, ?, ?)
      ON CONFLICT(repo, pr_number, comment_id) DO NOTHING
    `).run(repo, prNumber, commentId);
  } else {
    db.prepare(
      "DELETE FROM minimized_comments WHERE repo = ? AND pr_number = ? AND comment_id = ?",
    ).run(repo, prNumber, commentId);
  }
}

// ---------------------------------------------------------------------------
// User Display Names (1-week cache)
// ---------------------------------------------------------------------------

const DISPLAY_NAME_TTL_DAYS = 7;

/**
 * Bulk-upsert display names from PR list responses.
 * Only stores entries where name is a non-empty string.
 */
export function cacheDisplayNames(entries: Array<{ login: string; name: string | null }>): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO user_display_names (login, name, cached_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(login) DO UPDATE SET name = excluded.name, cached_at = excluded.cached_at
  `);
  for (const { login, name } of entries) {
    if (name) {
      stmt.run(login, name);
    }
  }
}

/**
 * Look up cached display names for a set of logins.
 * Returns only entries that are still within the TTL.
 */
export function getDisplayNames(logins: string[]): Map<string, string> {
  if (logins.length === 0) {
    return new Map();
  }
  const db = getDatabase();
  const placeholders = logins.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT login, name FROM user_display_names
       WHERE login IN (${placeholders})
         AND cached_at > datetime('now', '-${DISPLAY_NAME_TTL_DAYS} days')`,
    )
    .all(...logins) as Array<{ login: string; name: string }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.login, row.name);
  }
  return map;
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
  authorLogin: string;
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
    author_login: string | null;
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
    authorLogin: r.author_login ?? "",
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
  authorLogin?: string;
}): void {
  const db = getDatabase();
  db.prepare(
    "INSERT INTO notifications (type, title, body, pr_number, workspace, author_login) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(args.type, args.title, args.body, args.prNumber, args.workspace, args.authorLogin ?? null);
}

export function markNotificationRead(id: number): void {
  const db = getDatabase();
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
}

export function markAllNotificationsRead(): void {
  const db = getDatabase();
  db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
}

export function clearReadNotifications(): void {
  const db = getDatabase();
  db.prepare("DELETE FROM notifications WHERE read = 1").run();
}

export function clearAllNotifications(): void {
  const db = getDatabase();
  db.prepare("DELETE FROM notifications").run();
}

export function dismissNotification(id: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
}
