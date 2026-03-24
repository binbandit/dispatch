import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { ipc } from "./ipc";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  codeTheme: string;
  setCodeTheme: (theme: string) => void;
}

const DEFAULT_CODE_THEME_DARK = "github-dark-default";
const DEFAULT_CODE_THEME_LIGHT = "github-light-default";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
  codeTheme: DEFAULT_CODE_THEME_DARK,
  setCodeTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("dispatch-theme") as Theme) ?? "dark";
  });
  const [codeThemeDark, setCodeThemeDark] = useState<string>(() => {
    return localStorage.getItem("dispatch-code-theme-dark") ?? DEFAULT_CODE_THEME_DARK;
  });
  const [codeThemeLight, setCodeThemeLight] = useState<string>(() => {
    return localStorage.getItem("dispatch-code-theme-light") ?? DEFAULT_CODE_THEME_LIGHT;
  });

  const resolved = resolveTheme(theme);
  const codeTheme = resolved === "light" ? codeThemeLight : codeThemeDark;

  // Apply theme class on changes
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Load authoritative value from SQLite preferences on mount
  useEffect(() => {
    ipc("preferences.getAll", {
      keys: ["theme", "codeThemeDark", "codeThemeLight"],
    }).then((prefs) => {
      const savedTheme = prefs.theme;
      if (savedTheme && savedTheme !== theme) {
        setThemeState(savedTheme as Theme);
        localStorage.setItem("dispatch-theme", savedTheme);
        applyTheme(resolveTheme(savedTheme as Theme));
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Listen for system theme changes when preference is "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme(resolveTheme("system"));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("dispatch-theme", newTheme);
    applyTheme(resolveTheme(newTheme));
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
      value={{ theme, resolvedTheme: resolved, setTheme, codeTheme, setCodeTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
