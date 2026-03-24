import type { Highlighter } from "shiki";

import { createHighlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Core languages loaded upfront. Others are loaded on-demand
 * via highlighter.loadLanguage() when first encountered.
 */
const CORE_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "yaml",
  "css",
  "html",
  "markdown",
  "shell",
] as const;

/**
 * Lazily initialize a shared Shiki highlighter instance (WASM-based).
 * Loads only core languages upfront. Others are loaded on-demand.
 * Resets on failure to allow retry.
 */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default", "github-light-default"],
      langs: [...CORE_LANGS],
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

/**
 * Ensure a theme is loaded in the highlighter.
 * No-op if already loaded. Safe to call repeatedly.
 */
export async function ensureTheme(theme: string): Promise<void> {
  const h = await getHighlighter();
  if (!h.getLoadedThemes().includes(theme)) {
    try {
      await h.loadTheme(theme as Parameters<Highlighter["loadTheme"]>[0]);
    } catch {
      // Theme not supported by Shiki — will fall back to default
    }
  }
}

/**
 * Ensure a language is loaded in the highlighter.
 * No-op if already loaded. Safe to call repeatedly.
 */
export async function ensureLanguage(lang: string): Promise<void> {
  const h = await getHighlighter();
  if (!h.getLoadedLanguages().includes(lang)) {
    try {
      await h.loadLanguage(lang as Parameters<Highlighter["loadLanguage"]>[0]);
    } catch {
      // Language not supported by Shiki — will fall back to plain text
    }
  }
}

/**
 * Infer language from file path extension.
 */
export function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    css: "css",
    html: "html",
    md: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    dockerfile: "dockerfile",
    graphql: "graphql",
    gql: "graphql",
    swift: "swift",
    kt: "kotlin",
    c: "c",
    cpp: "cpp",
    h: "c",
  };
  return map[ext] ?? "text";
}
