import { ipc } from "@/renderer/lib/app/ipc";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
} from "@/renderer/lib/review/highlighter";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type ThemeStyle = "default";
export type ColorMode = "dark" | "oled" | "light" | "system";
type ResolvedTheme = "dark" | "light";

const LEGACY_THEME_STORAGE_KEY = "dispatch-theme";
const STYLE_STORAGE_KEY = "dispatch-theme-style";
const MODE_STORAGE_KEY = "dispatch-color-mode";
const LEGACY_SINGLE_CODE_THEME_STORAGE_KEY = "dispatch-code-theme";
const LEGACY_SINGLE_CODE_THEME_PREFERENCE_KEY = "codeTheme";
const FONT_LIGATURES_STORAGE_KEY = "dispatch-disable-font-ligatures";
const FONT_LIGATURES_PREFERENCE_KEY = "disableFontLigatures";

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

function readBooleanPreference(value: string | null, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
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
      return { style: "default", mode: "dark" };
    case "neo-brutal-light":
      return { style: "default", mode: "light" };
    case "neo-brutal-oled":
      return { style: "default", mode: "oled" };
    default:
      return { style: "default", mode: "dark" };
  }
}

function normalizeThemeStyle(style: string | null | undefined): ThemeStyle {
  return style === "default" ? style : "default";
}

interface ThemeState {
  themeStyle: ThemeStyle;
  colorMode: ColorMode;
  resolvedTheme: ResolvedTheme;
  codeTheme: string;
  codeThemeLight: string;
  codeThemeDark: string;
  disableFontLigatures: boolean;
  setThemeStyle: (style: ThemeStyle) => void;
  setColorMode: (mode: ColorMode) => void;
  setCodeTheme: (theme: string) => void;
  setDisableFontLigatures: (disable: boolean) => void;
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

function deriveThemeClass(_style: ThemeStyle, mode: ColorMode, resolved: ResolvedTheme): string {
  const isOled = mode === "oled";
  if (isOled) return "oled";
  return resolved;
}

const ALL_THEME_CLASSES = ["dark", "light", "oled"];

function applyTheme(style: ThemeStyle, mode: ColorMode, resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(...ALL_THEME_CLASSES);
  root.classList.add(deriveThemeClass(style, mode, resolved));
  root.style.colorScheme = resolved;
}

function applyFontLigaturePreference(disableFontLigatures: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("font-ligatures-off", disableFontLigatures);
}

function readInitialValues(): { style: ThemeStyle; mode: ColorMode } {
  const storage = safeLocalStorage();
  if (!storage) return { style: "default", mode: "dark" };

  const savedStyle = storage.getItem(STYLE_STORAGE_KEY) as ThemeStyle | null;
  const savedMode = storage.getItem(MODE_STORAGE_KEY) as ColorMode | null;
  if (savedStyle && savedMode) {
    return { style: normalizeThemeStyle(savedStyle), mode: savedMode };
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
const initialDisableFontLigatures = readBooleanPreference(
  safeLocalStorage()?.getItem(FONT_LIGATURES_STORAGE_KEY) ?? null,
  false,
);
const initialCodeDark = readCodeThemePreference(
  "dispatch-code-theme-dark",
  legacyCodeTheme ?? DEFAULT_CODE_THEME_DARK,
);
const initialCodeLight = readCodeThemePreference(
  "dispatch-code-theme-light",
  legacyCodeTheme ?? DEFAULT_CODE_THEME_LIGHT,
);

applyTheme(initial.style, initial.mode, initialResolved);
applyFontLigaturePreference(initialDisableFontLigatures);

export const useThemeStore = create<ThemeState>()((set, get) => ({
  themeStyle: initial.style,
  colorMode: initial.mode,
  resolvedTheme: initialResolved,
  codeThemeDark: initialCodeDark,
  codeThemeLight: initialCodeLight,
  codeTheme: initialResolved === "light" ? initialCodeLight : initialCodeDark,
  disableFontLigatures: initialDisableFontLigatures,

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
  setDisableFontLigatures: (disable) => {
    safeLocalStorage()?.setItem(FONT_LIGATURES_STORAGE_KEY, disable ? "true" : "false");
    applyFontLigaturePreference(disable);
    set({ disableFontLigatures: disable });
    ipc("preferences.set", {
      key: FONT_LIGATURES_PREFERENCE_KEY,
      value: disable ? "true" : "false",
    });
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
      FONT_LIGATURES_PREFERENCE_KEY,
    ],
  });
  if (initResult && typeof initResult.then === "function")
    initResult
      .then((prefs) => {
        const state = useThemeStore.getState();
        const storage = safeLocalStorage();
        const dbFontLigatures = readBooleanPreference(
          prefs[FONT_LIGATURES_PREFERENCE_KEY] ?? null,
          state.disableFontLigatures,
        );

        if (prefs.themeStyle && prefs.colorMode) {
          const dbStyle = normalizeThemeStyle(prefs.themeStyle);
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
          disableFontLigatures: dbFontLigatures,
        });
        storage?.setItem(FONT_LIGATURES_STORAGE_KEY, dbFontLigatures ? "true" : "false");
        applyFontLigaturePreference(dbFontLigatures);
      })
      .catch(() => {});
}

// ---------------------------------------------------------------------------
// Backward-compatible hook
// ---------------------------------------------------------------------------

export function useTheme() {
  return useThemeStore(useShallow((s) => s));
}
