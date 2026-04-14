/* eslint-disable import/max-dependencies -- Code theme preview and selection widgets intentionally stay grouped so the appearance section is easier to maintain. */
import type { Highlighter } from "shiki";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useTheme, type ColorMode, type ThemeStyle } from "@/renderer/lib/app/theme-context";
import { ensureTheme, getHighlighter } from "@/renderer/lib/review/highlighter";
import { Check, Eclipse, Monitor, Moon, Sun } from "lucide-react";
import { memo, useEffect, useState } from "react";

/* ---------------------------------------------------------------------------
 * Theme style options (card picker)
 * --------------------------------------------------------------------------- */

export interface ThemeStyleOption {
  value: ThemeStyle;
  label: string;
  description: string;
  /** Representative colors: [bg, accent, text, border] */
  colors: [string, string, string, string];
  experimental?: boolean;
}

export const THEME_STYLE_OPTIONS: ThemeStyleOption[] = [
  {
    value: "default",
    label: "Default",
    description: "Warm dark theme with copper accents",
    colors: ["#08080a", "#d4883a", "#f0ece6", "#25231f"],
  },
  {
    value: "neo-brutalism",
    label: "Neo-Brutalism",
    description: "Cream paper, orange accents, and hard shadows",
    colors: ["#f5f0e8", "#ff6b35", "#ffffff", "#1a1a1a"],
    experimental: true,
  },
];

export function getThemeStyleOptions(includeNeoBrutalism: boolean): ThemeStyleOption[] {
  return THEME_STYLE_OPTIONS.filter((option) => {
    if (option.value === "neo-brutalism") {
      return includeNeoBrutalism;
    }
    return true;
  });
}

export function ThemeStyleCard({
  option,
  isActive,
  onSelect,
}: {
  option: ThemeStyleOption;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { themeStyle } = useTheme();
  const isNeoBrutalTheme = themeStyle === "neo-brutalism";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-[background-color,border-color,color,box-shadow,transform] duration-[--duration-fast]",
        isNeoBrutalTheme ? "rounded-[4px] border-2 bg-[--bg-surface]" : "rounded-md border",
        isActive
          ? isNeoBrutalTheme
            ? "border-[--primary] bg-[--accent-muted] shadow-[3px_3px_0_var(--primary)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--primary)]"
            : "border-[--border-accent] bg-[--accent-muted]"
          : isNeoBrutalTheme
            ? "border-[--border] shadow-[var(--shadow-sm)] hover:translate-x-px hover:translate-y-px hover:bg-[--bg-raised] hover:shadow-[1px_1px_0_var(--border)]"
            : "border-[--border] hover:border-[--border-strong] hover:bg-[--bg-raised]",
      )}
    >
      <div className="flex shrink-0 items-center gap-1">
        {option.colors.map((color) => (
          <span
            key={color}
            className={cn(
              "h-3 w-3 border border-[--border-subtle]",
              isNeoBrutalTheme ? "rounded-[2px]" : "rounded-full",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-text-primary block truncate font-mono text-xs">{option.label}</span>
        <span className="text-text-ghost block truncate text-[10px]">{option.description}</span>
      </div>
      {isActive && (
        <Check
          size={13}
          className="shrink-0 text-[--accent-text]"
        />
      )}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Color mode options (segmented control)
 * --------------------------------------------------------------------------- */

export interface ColorModeOption {
  value: ColorMode;
  label: string;
  icon: typeof Moon;
}

const DARK_OPTION: ColorModeOption = { value: "dark", label: "Dark", icon: Moon };
const OLED_OPTION: ColorModeOption = { value: "oled", label: "OLED", icon: Eclipse };
const LIGHT_OPTION: ColorModeOption = { value: "light", label: "Light", icon: Sun };
const SYSTEM_OPTION: ColorModeOption = { value: "system", label: "System", icon: Monitor };

export function getColorModeOptions(includeOled: boolean): ColorModeOption[] {
  if (includeOled) {
    return [DARK_OPTION, OLED_OPTION, LIGHT_OPTION, SYSTEM_OPTION];
  }
  return [DARK_OPTION, LIGHT_OPTION, SYSTEM_OPTION];
}

/* ---------------------------------------------------------------------------
 * Code theme options (unchanged)
 * --------------------------------------------------------------------------- */

export interface CodeThemeOption {
  id: string;
  name: string;
}

export const CODE_THEMES_DARK: CodeThemeOption[] = [
  { id: "github-dark-default", name: "GitHub Dark" },
  { id: "github-dark-dimmed", name: "GitHub Dimmed" },
  { id: "one-dark-pro", name: "One Dark Pro" },
  { id: "dracula", name: "Dracula" },
  { id: "tokyo-night", name: "Tokyo Night" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha" },
  { id: "catppuccin-macchiato", name: "Catppuccin Macchiato" },
  { id: "nord", name: "Nord" },
  { id: "rose-pine-moon", name: "Rosé Pine Moon" },
  { id: "rose-pine", name: "Rosé Pine" },
  { id: "night-owl", name: "Night Owl" },
  { id: "monokai", name: "Monokai" },
  { id: "vitesse-dark", name: "Vitesse Dark" },
  { id: "vitesse-black", name: "Vitesse Black" },
  { id: "solarized-dark", name: "Solarized Dark" },
  { id: "material-theme-ocean", name: "Material Ocean" },
  { id: "material-theme-palenight", name: "Material Palenight" },
  { id: "poimandres", name: "Poimandres" },
  { id: "vesper", name: "Vesper" },
  { id: "ayu-dark", name: "Ayu Dark" },
  { id: "everforest-dark", name: "Everforest Dark" },
  { id: "kanagawa-wave", name: "Kanagawa Wave" },
  { id: "synthwave-84", name: "Synthwave '84" },
  { id: "houston", name: "Houston" },
  { id: "andromeeda", name: "Andromeeda" },
];

export const CODE_THEMES_LIGHT: CodeThemeOption[] = [
  { id: "github-light-default", name: "GitHub Light" },
  { id: "github-light", name: "GitHub Light Classic" },
  { id: "one-light", name: "One Light" },
  { id: "catppuccin-latte", name: "Catppuccin Latte" },
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn" },
  { id: "vitesse-light", name: "Vitesse Light" },
  { id: "solarized-light", name: "Solarized Light" },
  { id: "min-light", name: "Min Light" },
  { id: "ayu-light", name: "Ayu Light" },
  { id: "everforest-light", name: "Everforest Light" },
  { id: "snazzy-light", name: "Snazzy Light" },
  { id: "slack-ochin", name: "Slack Ochin" },
  { id: "light-plus", name: "Light+" },
];

const PREVIEW_CODE = `interface Repository {
  name: string;
  stars: number;
  private: boolean;
}

async function fetchRepos(org: string) {
  const url = \`/api/orgs/\${org}/repos\`;
  const res = await fetch(url);
  return res.json() as Promise<Repository[]>;
}`;

export const CodeThemePreview = memo(function CodeThemePreview({ themeId }: { themeId: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureTheme(themeId);
      const highlighter = await getHighlighter();
      const result = highlighter.codeToHtml(PREVIEW_CODE, {
        lang: "typescript",
        theme: themeId,
      });
      if (!cancelled) {
        setHtml(result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  if (!html) {
    return (
      <div className="bg-bg-root border-border flex h-[220px] items-center justify-center rounded-md border">
        <Spinner className="text-text-tertiary h-4 w-4" />
      </div>
    );
  }

  return (
    <div
      className="[&_code]:!font-mono [&_pre]:!rounded-md [&_pre]:!border [&_pre]:!border-[--border] [&_pre]:!p-3 [&_pre]:!text-[12.5px] [&_pre]:!leading-[20px]"
      // Biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is safe
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function CodeThemeCard({
  theme,
  isActive,
  onSelect,
}: {
  theme: CodeThemeOption;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { themeStyle } = useTheme();
  const [colors, setColors] = useState<string[] | null>(null);
  const isNeoBrutalTheme = themeStyle === "neo-brutalism";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureTheme(theme.id);
      const highlighter = await getHighlighter();
      const sample = 'const x: string = "hello";';
      const tokens = highlighter.codeToTokens(sample, {
        lang: "typescript",
        theme: theme.id,
      } as Parameters<Highlighter["codeToTokens"]>[1]);
      if (cancelled) {
        return;
      }
      const seen = new Set<string>();
      const result: string[] = [];
      for (const token of tokens.tokens[0] ?? []) {
        const color = token.color?.toLowerCase();
        if (color && !seen.has(color) && color !== tokens.bg?.toLowerCase()) {
          seen.add(color);
          result.push(color);
        }
        if (result.length >= 4) {
          break;
        }
      }
      setColors(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [theme.id]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-[background-color,border-color,color,box-shadow,transform] duration-[--duration-fast]",
        isNeoBrutalTheme ? "rounded-[4px] border-2 bg-[--bg-surface]" : "rounded-md border",
        isActive
          ? isNeoBrutalTheme
            ? "border-[--primary] bg-[--accent-muted] shadow-[3px_3px_0_var(--primary)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--primary)]"
            : "border-[--border-accent] bg-[--accent-muted]"
          : isNeoBrutalTheme
            ? "border-[--border] shadow-[var(--shadow-sm)] hover:translate-x-px hover:translate-y-px hover:bg-[--bg-raised] hover:shadow-[1px_1px_0_var(--border)]"
            : "border-[--border] hover:border-[--border-strong] hover:bg-[--bg-raised]",
      )}
    >
      <div className="flex shrink-0 items-center gap-1">
        {colors
          ? colors.map((color) => (
              <span
                key={color}
                className={cn(
                  "h-3 w-3 border border-[--border-subtle]",
                  isNeoBrutalTheme ? "rounded-[2px]" : "rounded-full",
                )}
                style={{ backgroundColor: color }}
              />
            ))
          : Array.from({ length: 4 }).map((_, index) => (
              <span
                key={index}
                className={cn(
                  "bg-bg-elevated h-3 w-3 animate-pulse",
                  isNeoBrutalTheme ? "rounded-[2px]" : "rounded-full",
                )}
              />
            ))}
      </div>
      <span className="text-text-primary flex-1 truncate font-mono text-xs">{theme.name}</span>
      {isActive && (
        <Check
          size={13}
          className="shrink-0 text-[--accent-text]"
        />
      )}
    </button>
  );
}
