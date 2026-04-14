import { ipc } from "@/renderer/lib/app/ipc";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
} from "@/renderer/lib/review/highlighter";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light" | "oled" | "system";
type ResolvedTheme = "dark" | "light";
const LEGACY_SINGLE_CODE_THEME_STORAGE_KEY = "dispatch-code-theme";
const LEGACY_SINGLE_CODE_THEME_PREFERENCE_KEY = "codeTheme";

function readCodeThemePreference(storageKey: string, fallback: string): string {
  return localStorage.getItem(storageKey) ?? fallback;
}

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  codeTheme: string;
  codeThemeLight: string;
  codeThemeDark: string;
  setCodeTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
  codeTheme: DEFAULT_CODE_THEME_DARK,
  codeThemeDark: DEFAULT_CODE_THEME_DARK,
  codeThemeLight: DEFAULT_CODE_THEME_LIGHT,
  setCodeTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light", "oled");
  root.classList.add(theme === "system" ? resolved : theme);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem("dispatch-theme") as Theme) ?? "dark",
  );
  const [codeThemeDark, setCodeThemeDark] = useState<string>(() =>
    readCodeThemePreference(
      "dispatch-code-theme-dark",
      localStorage.getItem(LEGACY_SINGLE_CODE_THEME_STORAGE_KEY) ?? DEFAULT_CODE_THEME_DARK,
    ),
  );
  const [codeThemeLight, setCodeThemeLight] = useState<string>(() =>
    readCodeThemePreference(
      "dispatch-code-theme-light",
      localStorage.getItem(LEGACY_SINGLE_CODE_THEME_STORAGE_KEY) ?? DEFAULT_CODE_THEME_LIGHT,
    ),
  );

  const resolved = resolveTheme(theme);
  const codeTheme = resolved === "light" ? codeThemeLight : codeThemeDark;

  // Apply theme class on changes
  useEffect(() => {
    applyTheme(theme, resolved);
  }, [resolved, theme]);

  // Load authoritative value from SQLite preferences on mount
  useEffect(() => {
    ipc("preferences.getAll", {
      keys: ["theme", "codeThemeDark", "codeThemeLight", LEGACY_SINGLE_CODE_THEME_PREFERENCE_KEY],
    }).then((prefs) => {
      const savedTheme = prefs.theme;
      if (savedTheme && savedTheme !== theme) {
        setThemeState(savedTheme as Theme);
        localStorage.setItem("dispatch-theme", savedTheme);
        applyTheme(savedTheme as Theme, resolveTheme(savedTheme as Theme));
      }
      const savedDark = prefs.codeThemeDark;
      if (savedDark) {
        setCodeThemeDark(savedDark);
        localStorage.setItem("dispatch-code-theme-dark", savedDark);
      }
      const savedLight = prefs.codeThemeLight;
      if (savedLight) {
        setCodeThemeLight(savedLight);
        localStorage.setItem("dispatch-code-theme-light", savedLight);
      }
      if (!savedDark && !savedLight && prefs.codeTheme) {
        setCodeThemeDark(prefs.codeTheme);
        setCodeThemeLight(prefs.codeTheme);
        localStorage.setItem("dispatch-code-theme-dark", prefs.codeTheme);
        localStorage.setItem("dispatch-code-theme-light", prefs.codeTheme);
        ipc("preferences.set", { key: "codeThemeDark", value: prefs.codeTheme });
        ipc("preferences.set", { key: "codeThemeLight", value: prefs.codeTheme });
        localStorage.removeItem(LEGACY_SINGLE_CODE_THEME_STORAGE_KEY);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Listen for system theme changes when preference is "system"
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mq = globalThis.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme("system", resolveTheme("system"));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("dispatch-theme", newTheme);
    applyTheme(newTheme, resolveTheme(newTheme));
    ipc("preferences.set", { key: "theme", value: newTheme });
  }, []);

  const setCodeTheme = useCallback(
    (newCodeTheme: string) => {
      if (resolved === "light") {
        setCodeThemeLight(newCodeTheme);
        localStorage.setItem("dispatch-code-theme-light", newCodeTheme);
        ipc("preferences.set", { key: "codeThemeLight", value: newCodeTheme });
      } else {
        setCodeThemeDark(newCodeTheme);
        localStorage.setItem("dispatch-code-theme-dark", newCodeTheme);
        ipc("preferences.set", { key: "codeThemeDark", value: newCodeTheme });
      }
    },
    [resolved],
  );

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme: resolved,
        setTheme,
        codeTheme,
        codeThemeLight,
        codeThemeDark,
        setCodeTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
