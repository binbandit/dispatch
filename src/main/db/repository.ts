import type {
  AiReviewSummaryCacheEntry,
  AiTriageCacheEntry,
  GhPrDetail,
  GhPrListItem,
  PrActivityState,
} from "../../shared/ipc";
import type {
  ReviewResumeSelectedCommit,
  ReviewResumeState,
} from "../../shared/ipc/contracts/review";

import { getDatabase } from "./database";
import { splitWorkspaceRows } from "./workspace-state";

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

export function getResumeState(workspace: string): ReviewResumeState | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT
        workspace,
        view,
        pr_number,
        current_file_path,
        current_file_index,
        diff_mode,
        panel_open,
        panel_tab,
        selected_commit_oid,
        selected_commit_message,
        updated_at
      FROM review_resume_state
      WHERE workspace = ?
    `)
    .get(workspace) as
    | {
        workspace: string;
        view: ReviewResumeState["view"];
        pr_number: number | null;
        current_file_path: string | null;
        current_file_index: number;
        diff_mode: ReviewResumeState["diffMode"];
        panel_open: number;
        panel_tab: ReviewResumeState["panelTab"];
        selected_commit_oid: string | null;
        selected_commit_message: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const selectedCommit: ReviewResumeSelectedCommit | null =
    row.selected_commit_oid !== null && row.selected_commit_message !== null
      ? { oid: row.selected_commit_oid, message: row.selected_commit_message }
      : null;

  return {
    workspace: row.workspace,
    view: row.view,
    prNumber: row.pr_number,
    currentFilePath: row.current_file_path,
    currentFileIndex: row.current_file_index,
    diffMode: row.diff_mode,
    panelOpen: row.panel_open === 1,
    panelTab: row.panel_tab,
    selectedCommit,
    updatedAt: row.updated_at,
  };
}

export function saveResumeState(state: Omit<ReviewResumeState, "updatedAt">): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO review_resume_state (
      workspace,
      view,
      pr_number,
      current_file_path,
      current_file_index,
      diff_mode,
      panel_open,
      panel_tab,
      selected_commit_oid,
      selected_commit_message,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace) DO UPDATE SET
      view = excluded.view,
      pr_number = excluded.pr_number,
      current_file_path = excluded.current_file_path,
      current_file_index = excluded.current_file_index,
      diff_mode = excluded.diff_mode,
      panel_open = excluded.panel_open,
      panel_tab = excluded.panel_tab,
      selected_commit_oid = excluded.selected_commit_oid,
      selected_commit_message = excluded.selected_commit_message,
      updated_at = excluded.updated_at
  `).run(
    state.workspace,
    state.view,
    state.prNumber,
    state.currentFilePath,
    state.currentFileIndex,
    state.diffMode,
    state.panelOpen ? 1 : 0,
    state.panelTab,
    state.selectedCommit?.oid ?? null,
    state.selectedCommit?.message ?? null,
  );
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

function persistViewedFiles(args: {
  repo: string;
  prNumber: number;
  filePaths: string[];
  viewed: boolean;
}): void {
  if (args.filePaths.length === 0) {
    return;
  }

  const db = getDatabase();
  const writeViewedFile = db.prepare(`
    INSERT INTO viewed_files (repo, pr_number, file_path, viewed)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(repo, pr_number, file_path) DO UPDATE SET viewed = excluded.viewed
  `);

  const writeViewedFiles = db.transaction((filePaths: string[]) => {
    for (const filePath of filePaths) {
      writeViewedFile.run(args.repo, args.prNumber, filePath, args.viewed ? 1 : 0);
    }
  });

  writeViewedFiles(args.filePaths);
}

/* eslint-disable-next-line max-params -- These sqlite helpers mirror the table key shape directly. */
export function setFileViewed(
  repo: string,
  prNumber: number,
  filePath: string,
  viewed: boolean,
): void {
  persistViewedFiles({ repo, prNumber, filePaths: [filePath], viewed });
}

export function setFilesViewed(args: {
  repo: string;
  prNumber: number;
  filePaths: string[];
  viewed: boolean;
}): void {
  persistViewedFiles(args);
}

// ---------------------------------------------------------------------------
// PR Activity State
// ---------------------------------------------------------------------------

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
// Pull Request Cache
// ---------------------------------------------------------------------------

export interface PrCacheEntry {
  repo: string;
  prNumber: number;
  state: GhPrListItem["state"] | null;
  updatedAt: string | null;
  fetchedAt: string;
  listItem: GhPrListItem | null;
  detail: GhPrDetail | null;
}

export interface PrListCacheEntry<T> {
  data: T;
  fetchedAt: string;
}

function parseCachedJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toCachedPrListItem(detail: GhPrDetail): GhPrListItem {
  return {
    number: detail.number,
    title: detail.title,
    state: detail.state,
    author: detail.author,
    headRefName: detail.headRefName,
    baseRefName: detail.baseRefName,
    reviewDecision: detail.reviewDecision,
    statusCheckRollup: detail.statusCheckRollup.map(
      ({ detailsUrl: _detailsUrl, ...status }) => status,
    ),
    updatedAt: detail.updatedAt,
    url: detail.url,
    isDraft: detail.isDraft,
    additions: detail.additions,
    deletions: detail.deletions,
    mergeable: detail.mergeable,
    autoMergeRequest: detail.autoMergeRequest,
  };
}

export function getPrCache(repo: string, prNumber: number): PrCacheEntry | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT repo, number, data, detail_data, state, updated_at, fetched_at
      FROM pr_cache
      WHERE repo = ? AND number = ?
    `)
    .get(repo, prNumber) as
    | {
        repo: string;
        number: number;
        data: string;
        detail_data: string | null;
        state: GhPrListItem["state"] | null;
        updated_at: string | null;
        fetched_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    repo: row.repo,
    prNumber: row.number,
    state: row.state,
    updatedAt: row.updated_at,
    fetchedAt: row.fetched_at,
    listItem: parseCachedJson<GhPrListItem>(row.data),
    detail: parseCachedJson<GhPrDetail>(row.detail_data),
  };
}

export function savePrListItems(repo: string, items: GhPrListItem[]): void {
  if (items.length === 0) {
    return;
  }

  const db = getDatabase();
  const writePrListItem = db.prepare(`
    INSERT INTO pr_cache (repo, number, data, state, updated_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(repo, number) DO UPDATE SET
      data = excluded.data,
      state = excluded.state,
      updated_at = excluded.updated_at,
      fetched_at = excluded.fetched_at
  `);

  const writePrListItems = db.transaction((entries: GhPrListItem[]) => {
    for (const item of entries) {
      writePrListItem.run(repo, item.number, JSON.stringify(item), item.state, item.updatedAt);
    }
  });

  writePrListItems(items);
}

export function savePrDetail(repo: string, detail: GhPrDetail): void {
  const db = getDatabase();
  const listItem = toCachedPrListItem(detail);

  db.prepare(`
    INSERT INTO pr_cache (repo, number, data, detail_data, state, updated_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(repo, number) DO UPDATE SET
      data = excluded.data,
      detail_data = excluded.detail_data,
      state = excluded.state,
      updated_at = excluded.updated_at,
      fetched_at = excluded.fetched_at
  `).run(
    repo,
    detail.number,
    JSON.stringify(listItem),
    JSON.stringify(detail),
    detail.state,
    detail.updatedAt,
  );
}

export function getPrListCache<T>(args: {
  repo: string;
  filter: "reviewRequested" | "authored" | "all";
  state: "closed" | "merged";
  cacheKey: string;
}): PrListCacheEntry<T> | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT data, fetched_at
      FROM pr_list_cache
      WHERE repo = ? AND filter = ? AND state = ? AND limit_key = ?
    `)
    .get(args.repo, args.filter, args.state, args.cacheKey) as
    | {
        data: string;
        fetched_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const data = parseCachedJson<T>(row.data);
  if (!data) {
    return null;
  }

  return {
    data,
    fetchedAt: row.fetched_at,
  };
}

export function savePrListCache<T>(args: {
  repo: string;
  filter: "reviewRequested" | "authored" | "all";
  state: "closed" | "merged";
  cacheKey: string;
  data: T;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO pr_list_cache (repo, filter, state, limit_key, data, fetched_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(repo, filter, state, limit_key) DO UPDATE SET
      data = excluded.data,
      fetched_at = excluded.fetched_at
  `).run(args.repo, args.filter, args.state, args.cacheKey, JSON.stringify(args.data));
}

export function invalidatePersistedPrCaches(repo: string, prNumber?: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM pr_list_cache WHERE repo = ?").run(repo);

  if (prNumber !== undefined) {
    db.prepare("DELETE FROM pr_cache WHERE repo = ? AND number = ?").run(repo, prNumber);
  }
}

// ---------------------------------------------------------------------------
// AI Review Summary Cache
// ---------------------------------------------------------------------------

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

export function addWorkspace(args: {
  owner: string;
  repo: string;
  path?: string | null;
  name: string;
}): void {
  const db = getDatabase();
  // Check if workspace already exists by owner/repo or path
  const existing = db
    .prepare(
      "SELECT id FROM workspaces WHERE (owner = ? AND repo = ?) OR (path IS NOT NULL AND path = ?)",
    )
    .get(args.owner, args.repo, args.path ?? null) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE workspaces SET
        owner = ?,
        repo = ?,
        path = COALESCE(?, path),
        name = ?
      WHERE id = ?
    `).run(args.owner, args.repo, args.path ?? null, args.name, existing.id);
  } else {
    db.prepare(`
      INSERT INTO workspaces (owner, repo, path, name, added_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(args.owner, args.repo, args.path ?? null, args.name);
  }
}

function pruneMissingWorkspaces(): Array<{
  id: number;
  owner: string | null;
  repo: string | null;
  path: string | null;
  name: string;
  added_at: string;
}> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT id, owner, repo, path, name, added_at FROM workspaces ORDER BY added_at DESC")
    .all() as Array<{
    id: number;
    owner: string | null;
    repo: string | null;
    path: string | null;
    name: string;
    added_at: string;
  }>;

  const { staleRows, validRows } = splitWorkspaceRows(rows);

  if (staleRows.length === 0) {
    return validRows;
  }

  const staleIds = staleRows.map((row) => row.id);
  const stalePaths = staleRows.flatMap((row) => (row.path ? [row.path] : []));
  const idPlaceholders = staleIds.map(() => "?").join(", ");

  db.prepare(`DELETE FROM workspaces WHERE id IN (${idPlaceholders})`).run(...staleIds);
  if (stalePaths.length > 0) {
    const pathPlaceholders = stalePaths.map(() => "?").join(", ");
    db.prepare(`DELETE FROM repo_accounts WHERE path IN (${pathPlaceholders})`).run(...stalePaths);
  }

  const activeWorkspace = getPreference("activeWorkspace");
  if (activeWorkspace && staleIds.some((id) => String(id) === activeWorkspace)) {
    deletePreferences(["activeWorkspace"]);
  }

  return validRows;
}

export function getWorkspaces(): Array<{
  id: number;
  owner: string;
  repo: string;
  path: string | null;
  name: string;
  addedAt: string;
}> {
  const rows = pruneMissingWorkspaces();
  const workspaces: Array<{
    id: number;
    owner: string;
    repo: string;
    path: string | null;
    name: string;
    addedAt: string;
  }> = [];

  for (const row of rows) {
    if (row.owner && row.repo) {
      workspaces.push({
        id: row.id,
        owner: row.owner,
        repo: row.repo,
        path: row.path,
        name: row.name,
        addedAt: row.added_at,
      });
    }
  }

  return workspaces;
}

export function removeWorkspace(id: number): void {
  const db = getDatabase();
  const row = db.prepare("SELECT path FROM workspaces WHERE id = ?").get(id) as
    | { path: string | null }
    | undefined;
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);

  if (!row) {
    return;
  }

  if (row.path) {
    db.prepare("DELETE FROM repo_accounts WHERE path = ?").run(row.path);
  }

  const activeWorkspace = getPreference("activeWorkspace");
  if (activeWorkspace === String(id)) {
    deletePreferences(["activeWorkspace"]);
    const [fallback] = getWorkspaces();
    if (fallback) {
      setPreference("activeWorkspace", String(fallback.id));
    }
  }
}

/** Returns the active workspace's nwo (owner/repo), or null if none. */
export function getActiveWorkspaceNwo(): string | null {
  const activeId = getPreference("activeWorkspace");
  const workspaces = getWorkspaces();

  if (activeId) {
    const match = workspaces.find((ws) => String(ws.id) === activeId);
    if (match) {
      return `${match.owner}/${match.repo}`;
    }
    deletePreferences(["activeWorkspace"]);
  }

  const [fallback] = workspaces;
  if (fallback) {
    setPreference("activeWorkspace", String(fallback.id));
    return `${fallback.owner}/${fallback.repo}`;
  }

  return null;
}

export function getActiveWorkspace(): {
  id: number;
  owner: string;
  repo: string;
  path: string | null;
  name: string;
} | null {
  const activeId = getPreference("activeWorkspace");
  const workspaces = getWorkspaces();

  if (activeId) {
    // Try matching by ID first
    const matchById = workspaces.find((ws) => String(ws.id) === activeId);
    if (matchById) {
      return matchById;
    }

    // Migrate legacy path-based active workspace preference
    if (activeId.startsWith("/")) {
      const matchByPath = workspaces.find((ws) => ws.path === activeId);
      if (matchByPath) {
        setPreference("activeWorkspace", String(matchByPath.id));
        return matchByPath;
      }
    }

    deletePreferences(["activeWorkspace"]);
  }

  const [fallback] = workspaces;
  if (fallback) {
    setPreference("activeWorkspace", String(fallback.id));
    return fallback;
  }

  return null;
}

export function setActiveWorkspace(id: number): void {
  const db = getDatabase();
  const row = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(id) as
    | { id: number }
    | undefined;
  if (!row) {
    throw new Error(`Workspace not found: ${id}`);
  }

  setPreference("activeWorkspace", String(id));
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
