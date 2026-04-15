import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { app } from "electron";

let db: Database.Database | null = null;

function getDbPath(): string {
  return join(app.getPath("userData"), "dispatch.db");
}

/**
 * Initialize the SQLite database with WAL mode and schema.
 * Called once during app startup.
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  // Run schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS pr_cache (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      number        INTEGER NOT NULL,
      data          TEXT    NOT NULL,
      detail_data   TEXT,
      state         TEXT,
      updated_at    TEXT,
      fetched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, number)
    );

    CREATE TABLE IF NOT EXISTS pr_list_cache (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      filter        TEXT    NOT NULL,
      state         TEXT    NOT NULL,
      limit_key     TEXT    NOT NULL,
      data          TEXT    NOT NULL,
      fetched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, filter, state, limit_key)
    );

    CREATE TABLE IF NOT EXISTS review_state (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      last_sha      TEXT    NOT NULL,
      reviewed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, pr_number)
    );

    CREATE TABLE IF NOT EXISTS viewed_files (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      file_path     TEXT    NOT NULL,
      viewed        INTEGER NOT NULL DEFAULT 1,
      UNIQUE(repo, pr_number, file_path)
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key           TEXT    PRIMARY KEY,
      value         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT    NOT NULL,
      title         TEXT    NOT NULL,
      body          TEXT    NOT NULL DEFAULT '',
      pr_number     INTEGER,
      workspace     TEXT,
      author_login  TEXT,
      read          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pr_activity_state (
      id                   INTEGER PRIMARY KEY,
      repo                 TEXT    NOT NULL,
      pr_number            INTEGER NOT NULL,
      last_seen_updated_at TEXT    NOT NULL,
      seen_at              TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, pr_number)
    );

    CREATE TABLE IF NOT EXISTS ai_review_summaries (
      id            INTEGER PRIMARY KEY,
      workspace     TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      snapshot_key  TEXT    NOT NULL,
      summary       TEXT    NOT NULL,
      confidence_score INTEGER,
      generated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace, pr_number)
    );

    CREATE TABLE IF NOT EXISTS ai_triage_groups (
      id            INTEGER PRIMARY KEY,
      workspace     TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      snapshot_key  TEXT    NOT NULL,
      payload       TEXT    NOT NULL,
      generated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace, pr_number)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id            INTEGER PRIMARY KEY,
      owner         TEXT,
      repo          TEXT,
      path          TEXT    UNIQUE,
      name          TEXT    NOT NULL,
      added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner, repo)
    );

    CREATE TABLE IF NOT EXISTS repo_accounts (
      path          TEXT    PRIMARY KEY,
      host          TEXT    NOT NULL,
      login         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS minimized_comments (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      comment_id    TEXT    NOT NULL,
      minimized_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, pr_number, comment_id)
    );

    CREATE TABLE IF NOT EXISTS user_display_names (
      login         TEXT    PRIMARY KEY,
      name          TEXT    NOT NULL,
      cached_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profile_cache (
      login         TEXT    PRIMARY KEY,
      data          TEXT    NOT NULL,
      cached_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_resume_state (
      workspace              TEXT    PRIMARY KEY,
      view                   TEXT    NOT NULL,
      pr_number              INTEGER,
      current_file_path      TEXT,
      current_file_index     INTEGER NOT NULL DEFAULT 0,
      diff_mode              TEXT    NOT NULL DEFAULT 'all',
      panel_open             INTEGER NOT NULL DEFAULT 1,
      panel_tab              TEXT    NOT NULL DEFAULT 'overview',
      selected_commit_oid     TEXT,
      selected_commit_message TEXT,
      updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "author_login")) {
    db.exec("ALTER TABLE notifications ADD COLUMN author_login TEXT");
  }

  const aiReviewSummaryColumns = db
    .prepare("PRAGMA table_info(ai_review_summaries)")
    .all() as Array<{
    name: string;
  }>;
  if (!aiReviewSummaryColumns.some((column) => column.name === "confidence_score")) {
    db.exec("ALTER TABLE ai_review_summaries ADD COLUMN confidence_score INTEGER");
  }

  const prCacheColumns = db.prepare("PRAGMA table_info(pr_cache)").all() as Array<{
    name: string;
  }>;
  if (!prCacheColumns.some((column) => column.name === "detail_data")) {
    db.exec("ALTER TABLE pr_cache ADD COLUMN detail_data TEXT");
  }
  if (!prCacheColumns.some((column) => column.name === "state")) {
    db.exec("ALTER TABLE pr_cache ADD COLUMN state TEXT");
  }
  if (!prCacheColumns.some((column) => column.name === "updated_at")) {
    db.exec("ALTER TABLE pr_cache ADD COLUMN updated_at TEXT");
  }

  // Migration: normalize legacy workspaces schema for nullable path support and
  // Remote-only workspace workflows.
  const workspaceColumns = db.prepare("PRAGMA table_info(workspaces)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const hadOwnerColumn = workspaceColumns.some((column) => column.name === "owner");
  const hadRepoColumn = workspaceColumns.some((column) => column.name === "repo");
  const pathColumn = workspaceColumns.find((column) => column.name === "path");
  const hasLegacyPathConstraint = pathColumn?.notnull === 1;
  const shouldMigrateWorkspaces = !hadOwnerColumn || !hadRepoColumn || hasLegacyPathConstraint;

  if (shouldMigrateWorkspaces) {
    const selectOwner = hadOwnerColumn ? "owner" : "NULL AS owner";
    const selectRepo = hadRepoColumn ? "repo" : "NULL AS repo";

    db.exec(`
      CREATE TABLE workspaces_migrated (
        id            INTEGER PRIMARY KEY,
        owner         TEXT,
        repo          TEXT,
        path          TEXT    UNIQUE,
        name          TEXT    NOT NULL,
        added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(owner, repo)
      );

      INSERT INTO workspaces_migrated (id, owner, repo, path, name, added_at)
      SELECT id, ${selectOwner}, ${selectRepo}, path, name, added_at FROM workspaces;

      DROP TABLE workspaces;
      ALTER TABLE workspaces_migrated RENAME TO workspaces;
    `);

    if (!hadOwnerColumn || !hadRepoColumn) {
      // Populate owner/repo for existing workspaces from path (best-effort).
      // Path is like "/Users/x/code/owner/repo" — use last two segments as owner/repo.
      // This is a heuristic; actual owner/repo will be resolved via git remote on first use.
      const existingRows = db
        .prepare("SELECT id, path, name FROM workspaces WHERE owner IS NULL AND path IS NOT NULL")
        .all() as Array<{ id: number; path: string; name: string }>;
      const updateStmt = db.prepare("UPDATE workspaces SET owner = ?, repo = ? WHERE id = ?");
      for (const row of existingRows) {
        const segments = row.path.split("/").filter(Boolean);
        const repoName = segments.pop() ?? row.name;
        const ownerName = segments.pop() ?? "unknown";
        updateStmt.run(ownerName, repoName, row.id);
      }
    }
  }

  // Ensure unique index exists for (owner, repo) — ALTER TABLE can't add constraints.
  // Use WHERE to exclude NULL rows (shouldn't exist after migration, but safety).
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_repo ON workspaces(owner, repo) WHERE owner IS NOT NULL AND repo IS NOT NULL",
  );

  return db;
}

/**
 * Get the database instance.
 * Lazy-initializes if not yet created (handles race conditions where
 * the renderer fires IPC before app.whenReady completes, or after
 * GPU/network process crashes trigger a renderer reload).
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Destroy the entire database — close the connection and delete the file
 * (plus WAL/SHM journals). Used by the "nuke" reset flow.
 */
export function destroyDatabase(): void {
  closeDatabase();
  const dbPath = getDbPath();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }
}
