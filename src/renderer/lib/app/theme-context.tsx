import { ipc } from "@/renderer/lib/app/ipc";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
} from "@/renderer/lib/review/highlighter";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type ThemeStyle = "default" | "neo-brutalism";
export type ColorMode = "dark" | "oled" | "light" | "system";
type ResolvedTheme = "dark" | "light";

const LEGACY_THEME_STORAGE_KEY = "dispatch-theme";
const STYLE_STORAGE_KEY = "dispatch-theme-style";
const MODE_STORAGE_KEY = "dispatch-color-mode";
const LEGACY_SINGLE_CODE_THEME_STORAGE_KEY = "dispatch-code-theme";
const LEGACY_SINGLE_CODE_THEME_PREFERENCE_KEY = "codeTheme";

function safeLocalStorage() {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    /* test env */
  }
  return null;
}

function readCodeThemePreference(storageKey: string, fallback: string): string {
  return safeLocalStorage()?.getItem(storageKey) ?? fallback;
}

function migrateOldTheme(old: string): { style: ThemeStyle; mode: ColorMode } {
  switch (old) {
    case "light":
      return { style: "default", mode: "light" };
    case "system":
      return { style: "default", mode: "system" };
    case "oled":
      return { style: "default", mode: "oled" };
    case "neo-brutal-dark":
      return { style: "neo-brutalism", mode: "dark" };
    case "neo-brutal-light":
      return { style: "neo-brutalism", mode: "light" };
    case "neo-brutal-oled":
      return { style: "neo-brutalism", mode: "oled" };
    default:
      return { style: "default", mode: "dark" };
  }
}

interface ThemeState {
  themeStyle: ThemeStyle;
  colorMode: ColorMode;
  resolvedTheme: ResolvedTheme;
  codeTheme: string;
  codeThemeLight: string;
  codeThemeDark: string;
  setThemeStyle: (style: ThemeStyle) => void;
  setColorMode: (mode: ColorMode) => void;
  setCodeTheme: (theme: string) => void;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof globalThis.matchMedia !== "function") return "dark";
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveMode(mode: ColorMode): ResolvedTheme {
  if (mode === "system") return getSystemTheme();
  if (mode === "oled") return "dark";
  return mode;
}

function deriveThemeClass(style: ThemeStyle, mode: ColorMode, resolved: ResolvedTheme): string {
  const isOled = mode === "oled";
  if (style === "neo-brutalism") {
    if (isOled) return "neo-brutal-oled";
    return resolved === "dark" ? "neo-brutal-dark" : "neo-brutal-light";
  }
  if (isOled) return "oled";
  return resolved;
}

const ALL_THEME_CLASSES = [
  "dark",
  "light",
  "oled",
  "neo-brutal-dark",
  "neo-brutal-light",
  "neo-brutal-oled",
];

function applyTheme(style: ThemeStyle, mode: ColorMode, resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(...ALL_THEME_CLASSES);
  root.classList.add(deriveThemeClass(style, mode, resolved));
  root.style.colorScheme = resolved;
}

function readInitialValues(): { style: ThemeStyle; mode: ColorMode } {
  const storage = safeLocalStorage();
  if (!storage) return { style: "default", mode: "dark" };

  const savedStyle = storage.getItem(STYLE_STORAGE_KEY) as ThemeStyle | null;
  const savedMode = storage.getItem(MODE_STORAGE_KEY) as ColorMode | null;
  if (savedStyle && savedMode) {
    return { style: savedStyle, mode: savedMode };
  }
  const oldTheme = storage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (oldTheme) {
    const migrated = migrateOldTheme(oldTheme);
    storage.setItem(STYLE_STORAGE_KEY, migrated.style);
    storage.setItem(MODE_STORAGE_KEY, migrated.mode);
    return migrated;
  }
  return { style: "default", mode: "dark" };
}

// ---------------------------------------------------------------------------
// System theme listener management
// ---------------------------------------------------------------------------

let systemThemeCleanup: (() => void) | null = null;

function setupSystemThemeListener() {
  if (typeof globalThis.matchMedia !== "function") return;
  systemThemeCleanup?.();
  systemThemeCleanup = null;

  const mq = globalThis.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    const { themeStyle, codeThemeDark, codeThemeLight } = useThemeStore.getState();
    const newResolved = getSystemTheme();
    useThemeStore.setState({
      resolvedTheme: newResolved,
      codeTheme: newResolved === "light" ? codeThemeLight : codeThemeDark,
    });
    applyTheme(themeStyle, "system", newResolved);
  };
  mq.addEventListener("change", handler);
  systemThemeCleanup = () => mq.removeEventListener("change", handler);
}

function teardownSystemThemeListener() {
  systemThemeCleanup?.();
  systemThemeCleanup = null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initial = readInitialValues();
const initialResolved = resolveMode(initial.mode);
const legacyCodeTheme = safeLocalStorage()?.getItem(LEGACY_SINGLE_CODE_THEME_STORAGE_KEY);
const initialCodeDark = readCodeThemePreference(
  "dispatch-code-theme-dark",
  legacyCodeTheme ?? DEFAULT_CODE_THEME_DARK,
);
const initialCodeLight = readCodeThemePreference(
  "dispatch-code-theme-light",
  legacyCodeTheme ?? DEFAULT_CODE_THEME_LIGHT,
);

applyTheme(initial.style, initial.mode, initialResolved);

export const useThemeStore = create<ThemeState>()((set, get) => ({
  themeStyle: initial.style,
  colorMode: initial.mode,
  resolvedTheme: initialResolved,
  codeThemeDark: initialCodeDark,
  codeThemeLight: initialCodeLight,
  codeTheme: initialResolved === "light" ? initialCodeLight : initialCodeDark,

  setThemeStyle: (style) => {
    const { colorMode, resolvedTheme } = get();
    set({ themeStyle: style });
    applyTheme(style, colorMode, resolvedTheme);
    safeLocalStorage()?.setItem(STYLE_STORAGE_KEY, style);
    ipc("preferences.set", { key: "themeStyle", value: style });
  },

  setColorMode: (mode) => {
    const { themeStyle, codeThemeDark, codeThemeLight } = get();
    const r = resolveMode(mode);
    set({
      colorMode: mode,
      resolvedTheme: r,
      codeTheme: r === "light" ? codeThemeLight : codeThemeDark,
    });
    applyTheme(themeStyle, mode, r);
    safeLocalStorage()?.setItem(MODE_STORAGE_KEY, mode);
    ipc("preferences.set", { key: "colorMode", value: mode });

    if (mode === "system") {
      setupSystemThemeListener();
    } else {
      teardownSystemThemeListener();
    }
  },

  setCodeTheme: (theme) => {
    const { resolvedTheme } = get();
    const storage = safeLocalStorage();
    if (resolvedTheme === "light") {
      set({ codeThemeLight: theme, codeTheme: theme });
      storage?.setItem("dispatch-code-theme-light", theme);
      ipc("preferences.set", { key: "codeThemeLight", value: theme });
    } else {
      set({ codeThemeDark: theme, codeTheme: theme });
      storage?.setItem("dispatch-code-theme-dark", theme);
      ipc("preferences.set", { key: "codeThemeDark", value: theme });
    }
  },
}));

// ---------------------------------------------------------------------------
// Async initialization — load authoritative values from SQLite
// ---------------------------------------------------------------------------

if (initial.mode === "system" && typeof globalThis.matchMedia === "function") {
  setupSystemThemeListener();
}

if (typeof (globalThis as Record<string, unknown>).api !== "undefined") {
  const initResult = ipc("preferences.getAll", {
    keys: [
      "themeStyle",
      "colorMode",
      "theme",
      "codeThemeDark",
      "codeThemeLight",
      LEGACY_SINGLE_CODE_THEME_PREFERENCE_KEY,
    ],
  });
  if (initResult && typeof initResult.then === "function") initResult
    .then((prefs) => {
      const state = useThemeStore.getState();
      const storage = safeLocalStorage();

      if (prefs.themeStyle && prefs.colorMode) {
        const dbStyle = prefs.themeStyle as ThemeStyle;
        const dbMode = prefs.colorMode as ColorMode;
        if (dbStyle !== state.themeStyle || dbMode !== state.colorMode) {
          const r = resolveMode(dbMode);
          useThemeStore.setState({
            themeStyle: dbStyle,
            colorMode: dbMode,
            resolvedTheme: r,
            codeTheme: r === "light" ? state.codeThemeLight : state.codeThemeDark,
          });
          applyTheme(dbStyle, dbMode, r);
          storage?.setItem(STYLE_STORAGE_KEY, dbStyle);
          storage?.setItem(MODE_STORAGE_KEY, dbMode);

          if (dbMode === "system") {
            setupSystemThemeListener();
          } else {
            teardownSystemThemeListener();
          }
        }
      } else if (prefs.theme) {
        const migrated = migrateOldTheme(prefs.theme);
        const r = resolveMode(migrated.mode);
        useThemeStore.setState({
          themeStyle: migrated.style,
          colorMode: migrated.mode,
          resolvedTheme: r,
        });
        applyTheme(migrated.style, migrated.mode, r);
        storage?.setItem(STYLE_STORAGE_KEY, migrated.style);
        storage?.setItem(MODE_STORAGE_KEY, migrated.mode);
        ipc("preferences.set", { key: "themeStyle", value: migrated.style });
        ipc("preferences.set", { key: "colorMode", value: migrated.mode });
      }

      let updatedDark = state.codeThemeDark;
      let updatedLight = state.codeThemeLight;

      if (prefs.codeThemeDark) {
        updatedDark = prefs.codeThemeDark;
        storage?.setItem("dispatch-code-theme-dark", updatedDark);
      }
      if (prefs.codeThemeLight) {
        updatedLight = prefs.codeThemeLight;
        storage?.setItem("dispatch-code-theme-light", updatedLight);
      }

      if (!prefs.codeThemeDark && !prefs.codeThemeLight && prefs.codeTheme) {
        updatedDark = prefs.codeTheme;
        updatedLight = prefs.codeTheme;
        storage?.setItem("dispatch-code-theme-dark", updatedDark);
        storage?.setItem("dispatch-code-theme-light", updatedLight);
        ipc("preferences.set", { key: "codeThemeDark", value: updatedDark });
        ipc("preferences.set", { key: "codeThemeLight", value: updatedLight });
        if (storage) storage.removeItem(LEGACY_SINGLE_CODE_THEME_STORAGE_KEY);
      }

      const resolved = useThemeStore.getState().resolvedTheme;
      useThemeStore.setState({
        codeThemeDark: updatedDark,
        codeThemeLight: updatedLight,
        codeTheme: resolved === "light" ? updatedLight : updatedDark,
      });
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Backward-compatible hook
// ---------------------------------------------------------------------------

export function useTheme() {
  return useThemeStore(useShallow((s) => s));
}
