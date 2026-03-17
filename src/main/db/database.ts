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

  db.exec(`
    CREATE TABLE IF NOT EXISTS pr_cache (
      id            INTEGER PRIMARY KEY,
      repo          TEXT    NOT NULL,
      number        INTEGER NOT NULL,
      data          TEXT    NOT NULL,
      fetched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, number)
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

    CREATE TABLE IF NOT EXISTS workspaces (
      id            INTEGER PRIMARY KEY,
      path          TEXT    NOT NULL UNIQUE,
      name          TEXT    NOT NULL,
      added_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
