/* eslint-disable import/max-dependencies -- Code theme preview and selection widgets intentionally stay grouped so the appearance section is easier to maintain. */
import type { Highlighter } from "shiki";

import { Spinner } from "@/components/ui/spinner";
import { ensureTheme, getHighlighter } from "@/renderer/lib/review/highlighter";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { memo, useEffect, useState } from "react";

export const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

export const OLED_THEME_OPTION = { value: "oled", label: "OLED", icon: Moon } as const;

export function getThemeOptions(includeOled: boolean) {
  return includeOled
    ? [THEME_OPTIONS[0], OLED_THEME_OPTION, ...THEME_OPTIONS.slice(1)]
    : THEME_OPTIONS;
}

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
  const [colors, setColors] = useState<string[] | null>(null);

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
      className={`group relative flex cursor-pointer items-center gap-2.5 border px-3 py-2 text-left transition-all duration-[--duration-fast] ${
        isActive
          ? "border-[--border-accent] bg-[--accent-muted]"
          : "border-[--border] hover:border-[--border-strong] hover:bg-[--bg-raised]"
      } rounded-md`}
    >
      <div className="flex shrink-0 items-center gap-1">
        {colors
          ? colors.map((color) => (
              <span
                key={color}
                className="h-3 w-3 rounded-full border border-[--border-subtle]"
                style={{ backgroundColor: color }}
              />
            ))
          : Array.from({ length: 4 }).map((_, index) => (
              <span
                key={index}
                className="bg-bg-elevated h-3 w-3 animate-pulse rounded-full"
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
