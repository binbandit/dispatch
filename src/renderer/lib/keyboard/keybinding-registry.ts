/**
 * Centralized keybinding registry — single source of truth for all shortcut
 * IDs, default bindings, display labels, and categories.
 *
 * Pure data module — no React dependencies.
 */

export type Modifier = "meta" | "shift" | "alt" | "ctrl";

export type ShortcutCategory = "Navigation" | "Actions" | "Search" | "Views";

export interface ShortcutDefinition {
  id: string;
  key: string;
  modifiers?: Modifier[];
  label: string;
  category: ShortcutCategory;
}

export type KeybindingOverrides = Record<string, { key: string; modifiers?: Modifier[] }>;

export const DEFAULT_KEYBINDINGS: ShortcutDefinition[] = [
  // Navigation
  { id: "navigation.prevPr", key: "j", label: "Previous PR", category: "Navigation" },
  { id: "navigation.nextPr", key: "k", label: "Next PR", category: "Navigation" },
  { id: "navigation.openPr", key: "Enter", label: "Open PR", category: "Navigation" },
  { id: "navigation.nextRegion", key: "Tab", label: "Next review pane", category: "Navigation" },
  {
    id: "navigation.prevRegion",
    key: "Tab",
    modifiers: ["shift"],
    label: "Previous review pane",
    category: "Navigation",
  },
  { id: "navigation.prevFile", key: "[", label: "Previous file", category: "Navigation" },
  { id: "navigation.nextFile", key: "]", label: "Next file", category: "Navigation" },
  {
    id: "navigation.focusFiles",
    key: "f",
    label: "Focus left review pane",
    category: "Navigation",
  },
  { id: "navigation.focusDiff", key: "d", label: "Focus code view", category: "Navigation" },
  {
    id: "navigation.toggleSidebar",
    key: "b",
    modifiers: ["meta"],
    label: "Toggle sidebar",
    category: "Navigation",
  },
  {
    id: "navigation.back",
    key: "[",
    modifiers: ["meta"],
    label: "Go back",
    category: "Navigation",
  },
  {
    id: "navigation.forward",
    key: "]",
    modifiers: ["meta"],
    label: "Go forward",
    category: "Navigation",
  },
  { id: "navigation.prevHunk", key: "{", label: "Previous hunk", category: "Navigation" },
  { id: "navigation.nextHunk", key: "}", label: "Next hunk", category: "Navigation" },

  // Actions
  { id: "actions.togglePanel", key: "i", label: "Toggle overview panel", category: "Actions" },
  {
    id: "actions.togglePanelAlternate",
    key: "\\",
    modifiers: ["meta"],
    label: "Toggle overview panel (alternate)",
    category: "Actions",
  },
  {
    id: "actions.openConversation",
    key: "c",
    modifiers: ["meta", "shift"],
    label: "Open conversation tab",
    category: "Actions",
  },
  {
    id: "actions.openOverview",
    key: "o",
    modifiers: ["meta", "shift"],
    label: "Open overview tab",
    category: "Actions",
  },
  {
    id: "actions.openCommits",
    key: "t",
    modifiers: ["meta", "shift"],
    label: "Open commits tab",
    category: "Actions",
  },
  {
    id: "actions.openChecks",
    key: "x",
    modifiers: ["meta", "shift"],
    label: "Open checks tab",
    category: "Actions",
  },
  { id: "actions.focusPanel", key: "p", label: "Focus overview panel", category: "Actions" },
  {
    id: "actions.focusReviewBar",
    key: "g",
    modifiers: ["shift"],
    label: "Focus review actions bar",
    category: "Actions",
  },
  { id: "actions.toggleViewed", key: "v", label: "Toggle file viewed", category: "Actions" },
  { id: "actions.nextUnreviewed", key: "n", label: "Next unreviewed file", category: "Actions" },
  {
    id: "actions.nextUnresolvedThread",
    key: "u",
    label: "Next unresolved thread",
    category: "Actions",
  },
  { id: "actions.replyToThread", key: "r", label: "Reply to focused thread", category: "Actions" },
  { id: "actions.resolveThread", key: "e", label: "Resolve focused thread", category: "Actions" },
  {
    id: "actions.requestChanges",
    key: "r",
    modifiers: ["meta", "shift"],
    label: "Request changes",
    category: "Actions",
  },
  {
    id: "actions.approve",
    key: "a",
    modifiers: ["meta", "shift"],
    label: "Approve PR",
    category: "Actions",
  },
  {
    id: "actions.merge",
    key: "m",
    modifiers: ["meta", "shift"],
    label: "Merge PR",
    category: "Actions",
  },
  {
    id: "actions.focusMode",
    key: "f",
    modifiers: ["meta", "shift"],
    label: "Start focus-mode review session",
    category: "Actions",
  },
  {
    id: "actions.focusModeNext",
    key: "n",
    modifiers: ["meta", "shift"],
    label: "Advance focus-mode queue",
    category: "Actions",
  },
  { id: "actions.closePanel", key: "Escape", label: "Close panel / dialog", category: "Actions" },
  { id: "actions.nextComment", key: "c", label: "Next comment", category: "Actions" },
  {
    id: "actions.prevComment",
    key: "c",
    modifiers: ["shift"],
    label: "Previous comment",
    category: "Actions",
  },

  // Search
  { id: "search.focusSearch", key: "/", label: "Search current pane", category: "Search" },
  {
    id: "search.commandPalette",
    key: "k",
    modifiers: ["meta"],
    label: "Command palette",
    category: "Search",
  },
  {
    id: "search.commandPaletteAlt",
    key: "p",
    modifiers: ["meta", "shift"],
    label: "Command palette (alt)",
    category: "Search",
  },

  // Views
  { id: "views.review", key: "1", label: "Review", category: "Views" },
  { id: "views.workflows", key: "2", label: "Workflows", category: "Views" },
  { id: "views.metrics", key: "3", label: "Metrics", category: "Views" },
  { id: "views.releases", key: "4", label: "Releases", category: "Views" },
  { id: "views.mergeQueue", key: "5", label: "Merge queue", category: "Views" },
  { id: "views.shortcuts", key: "?", label: "Keyboard shortcuts", category: "Views" },
  {
    id: "views.settings",
    key: ",",
    modifiers: ["meta"],
    label: "Settings",
    category: "Views",
  },
];

export const DEFAULT_KEYBINDINGS_MAP = new Map(DEFAULT_KEYBINDINGS.map((def) => [def.id, def]));

/** Resolve the binding for a shortcut ID, preferring user overrides. */
export function resolveBinding(
  id: string,
  overrides: KeybindingOverrides,
): { key: string; modifiers?: Modifier[] } {
  const override = overrides[id];
  if (override) {
    return override;
  }
  const def = DEFAULT_KEYBINDINGS_MAP.get(id);
  if (def) {
    return { key: def.key, modifiers: def.modifiers };
  }
  return { key: "" };
}

const KEY_DISPLAY: Record<string, string> = {
  Enter: "\u23CE",
  Escape: "Esc",
  ArrowUp: "\u2191",
  ArrowDown: "\u2193",
  ArrowLeft: "\u2190",
  ArrowRight: "\u2192",
  Backspace: "\u232B",
  Delete: "\u2326",
  Tab: "\u21E5",
  " ": "Space",
};

function isMacPlatform(): boolean {
  return globalThis.navigator?.platform?.includes("Mac") ?? false;
}

function getModifierSymbol(modifier: Modifier): string {
  const mac = isMacPlatform();

  switch (modifier) {
    case "meta": {
      return mac ? "\u2318" : "Ctrl";
    }
    case "shift": {
      return mac ? "\u21E7" : "Shift";
    }
    case "alt": {
      return mac ? "\u2325" : "Alt";
    }
    case "ctrl": {
      return mac ? "\u2303" : "Ctrl";
    }
  }
}

/** Format a keybinding for display (e.g. "⌘B", "⇧?"). */
export function formatKeybinding(key: string, modifiers?: Modifier[]): string {
  const parts: string[] = [];
  if (modifiers) {
    for (const mod of modifiers) {
      parts.push(getModifierSymbol(mod));
    }
  }
  const displayKey = KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  parts.push(displayKey);
  return parts.join("");
}
