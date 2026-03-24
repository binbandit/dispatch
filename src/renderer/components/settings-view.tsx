import type { Highlighter } from "shiki";

import { Spinner } from "@/components/ui/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { ensureTheme, getHighlighter } from "../lib/highlighter";
import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useTheme } from "../lib/theme-context";

/**
 * Settings panel — persists all values via preferences IPC.
 *
 * Keys: mergeStrategy, prPollInterval, checksPollInterval
 */

const PREF_KEYS = [
  "mergeStrategy",
  "prPollInterval",
  "checksPollInterval",
  "aiProvider",
  "aiModel",
  "analytics-opted-in",
  "crash-reports-opted-in",
  "aiApiKey",
  "aiBaseUrl",
];

function getDefaultAiBaseUrl(provider: string): string {
  switch (provider) {
    case "openai": {
      return "https://api.openai.com/v1";
    }
    case "anthropic": {
      return "https://api.anthropic.com/v1";
    }
    case "ollama": {
      return "http://localhost:11434";
    }
    default: {
      return "Default";
    }
  }
}

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

// --- Code theme definitions ---

interface CodeThemeOption {
  id: string;
  name: string;
}

const CODE_THEMES_DARK: CodeThemeOption[] = [
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

const CODE_THEMES_LIGHT: CodeThemeOption[] = [
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

// --- Code theme preview ---

const CodeThemePreview = memo(function CodeThemePreview({ themeId }: { themeId: string }) {
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
      if (!cancelled) setHtml(result);
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
      className="[&_pre]:!rounded-md [&_pre]:!border [&_pre]:!border-[--border] [&_pre]:!p-3 [&_pre]:!text-[12.5px] [&_pre]:!leading-[20px] [&_code]:!font-[--font-mono]"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is safe
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

// --- Code theme grid item ---

function CodeThemeCard({
  theme,
  isActive,
  onSelect,
}: {
  theme: CodeThemeOption;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [colors, setColors] = useState<string[] | null>(null);

  // Extract a few representative token colors from the theme for the preview dots
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
      if (cancelled) return;
      // Collect unique non-bg colors from the first line
      const seen = new Set<string>();
      const result: string[] = [];
      for (const token of tokens.tokens[0] ?? []) {
        const c = token.color?.toLowerCase();
        if (c && !seen.has(c) && c !== tokens.bg?.toLowerCase()) {
          seen.add(c);
          result.push(c);
        }
        if (result.length >= 4) break;
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
      {/* Color dots */}
      <div className="flex items-center gap-1 shrink-0">
        {colors
          ? colors.map((c) => (
              <span
                key={c}
                className="h-3 w-3 rounded-full border border-[--border-subtle]"
                style={{ backgroundColor: c }}
              />
            ))
          : Array.from({ length: 4 }).map((_, i) => (
              <span
                key={i}
                className="bg-bg-elevated h-3 w-3 animate-pulse rounded-full"
              />
            ))}
      </div>
      <span className="text-text-primary flex-1 truncate font-mono text-xs">{theme.name}</span>
      {isActive && <Check size={13} className="text-[--accent-text] shrink-0" />}
    </button>
  );
}

export function SettingsView() {
  const { theme, setTheme, resolvedTheme, codeTheme, setCodeTheme } = useTheme();

  const codeThemeOptions = useMemo(
    () => (resolvedTheme === "light" ? CODE_THEMES_LIGHT : CODE_THEMES_DARK),
    [resolvedTheme],
  );

  // Load saved preferences
  const prefsQuery = useQuery({
    queryKey: ["preferences", PREF_KEYS],
    queryFn: () => ipc("preferences.getAll", { keys: PREF_KEYS }),
  });
  const aiConfigQuery = useQuery({
    queryKey: ["ai", "config"],
    queryFn: () => ipc("ai.config"),
    staleTime: 60_000,
  });

  const prefs = prefsQuery.data ?? {};
  const aiConfig = aiConfigQuery.data;
  const mergeStrategy = prefs.mergeStrategy ?? "squash";
  const prPollInterval = prefs.prPollInterval ?? "30";
  const checksPollInterval = prefs.checksPollInterval ?? "10";
  const effectiveAiProvider = prefs.aiProvider ?? aiConfig?.provider ?? "none";
  const envAiVars = [
    aiConfig?.providerSource === "environment" ? aiConfig.providerEnvVar : null,
    aiConfig?.modelSource === "environment" ? aiConfig.modelEnvVar : null,
    aiConfig?.apiKeySource === "environment" ? aiConfig.apiKeyEnvVar : null,
    aiConfig?.baseUrlSource === "environment" ? aiConfig.baseUrlEnvVar : null,
  ].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );

  const saveMutation = useMutation({
    mutationFn: async (args: { key: string; value: string }) => {
      await ipc("preferences.set", args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
  });

  function savePref(key: string, value: string) {
    saveMutation.mutate({ key, value });
  }

  if (prefsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto py-12">
      <div className="w-full max-w-lg">
        <h1 className="font-heading text-text-primary text-3xl italic">Settings</h1>
        <p className="text-text-secondary mt-1 text-sm">
          Configure Dispatch behavior. Changes save automatically.
        </p>

        {/* Appearance */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">Appearance</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">Choose your preferred color theme.</p>
          <div className="border-border bg-bg-raised mt-3 flex rounded-md border p-[2px]">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs ${
                  theme === value
                    ? "bg-bg-elevated text-text-primary shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Code Theme */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">Code Theme</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">
            Syntax highlighting theme for diffs.{" "}
            {resolvedTheme === "light" ? "Light" : "Dark"} themes shown for your current mode.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {codeThemeOptions.map((t) => (
              <CodeThemeCard
                key={t.id}
                theme={t}
                isActive={codeTheme === t.id}
                onSelect={() => setCodeTheme(t.id)}
              />
            ))}
          </div>
          <div className="mt-3">
            <label className="text-text-tertiary mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider">
              Preview
            </label>
            <CodeThemePreview themeId={codeTheme} />
          </div>
        </section>

        {/* Merge strategy */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">Default Merge Strategy</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">
            Which merge method to use by default when merging PRs.
          </p>
          <div className="border-border bg-bg-raised mt-3 flex rounded-md border p-[2px]">
            {(["squash", "merge", "rebase"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => savePref("mergeStrategy", s)}
                className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-xs capitalize ${
                  mergeStrategy === s
                    ? "bg-bg-elevated text-text-primary shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* Polling intervals */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">Polling Intervals</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">
            How often to check for updates (in seconds). Changes apply immediately.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-xs">PR list</span>
              <input
                type="number"
                min="5"
                max="300"
                value={prPollInterval}
                onChange={(e) => savePref("prPollInterval", e.target.value)}
                className="border-border bg-bg-root text-text-primary focus:border-primary w-20 rounded-md border px-2 py-1 text-right font-mono text-xs focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-xs">CI checks</span>
              <input
                type="number"
                min="5"
                max="300"
                value={checksPollInterval}
                onChange={(e) => savePref("checksPollInterval", e.target.value)}
                className="border-border bg-bg-root text-text-primary focus:border-primary w-20 rounded-md border px-2 py-1 text-right font-mono text-xs focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* AI provider */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">AI Provider</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">
            Configure an AI provider for code explanations and PR summaries.
          </p>
          {envAiVars.length > 0 && (
            <p className="text-text-tertiary mt-1 font-mono text-[10px]">
              Using {envAiVars.join(", ")} from the environment. Saved settings override these
              values. Select None to disable AI in Dispatch.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-xs">Provider</span>
              <select
                value={effectiveAiProvider}
                onChange={(e) => savePref("aiProvider", e.target.value)}
                className="border-border bg-bg-root text-text-primary focus:border-primary w-36 rounded-md border px-2 py-1 text-xs focus:outline-none"
              >
                <option value="none">None</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>
            {effectiveAiProvider !== "none" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Model</span>
                  <input
                    type="text"
                    value={prefs.aiModel ?? ""}
                    onChange={(e) => savePref("aiModel", e.target.value)}
                    placeholder={aiConfig?.model ?? "Model name"}
                    className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-36 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none"
                  />
                </div>
                {effectiveAiProvider !== "ollama" && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary text-xs">API Key</span>
                    <input
                      type="password"
                      value={prefs.aiApiKey ?? ""}
                      onChange={(e) => savePref("aiApiKey", e.target.value)}
                      placeholder={
                        aiConfig?.apiKeySource === "environment" && aiConfig.apiKeyEnvVar
                          ? `Using ${aiConfig.apiKeyEnvVar}`
                          : "sk-..."
                      }
                      className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-36 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-xs">Base URL</span>
                  <input
                    type="text"
                    value={prefs.aiBaseUrl ?? ""}
                    onChange={(e) => savePref("aiBaseUrl", e.target.value)}
                    placeholder={aiConfig?.baseUrl ?? getDefaultAiBaseUrl(effectiveAiProvider)}
                    className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-36 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none"
                  />
                </div>
                <p className="text-text-ghost -mt-1 text-[10px]">
                  OpenAI-compatible deployments can use a custom base URL such as{" "}
                  <span className="font-mono">https://gateway.example.com/v1</span> or a
                  fully-qualified endpoint.
                </p>
              </>
            )}
          </div>
        </section>

        {/* Analytics & Privacy */}
        <section className="mt-8">
          <h2 className="text-text-primary text-sm font-semibold">Privacy</h2>
          <p className="text-text-tertiary mt-0.5 text-xs">
            All data stays on your machine. These optional settings help improve Dispatch.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={prefs["analytics-opted-in"] === "true"}
                onChange={(e) =>
                  savePref("analytics-opted-in", e.target.checked ? "true" : "false")
                }
                className="accent-primary mt-0.5"
              />
              <div>
                <span className="text-text-secondary text-xs">Send anonymous usage data</span>
                <p className="text-text-ghost mt-0.5 text-[10px]">
                  We track which features are used, not what you review. No code, file paths, or PR
                  content.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={prefs["crash-reports-opted-in"] === "true"}
                onChange={(e) =>
                  savePref("crash-reports-opted-in", e.target.checked ? "true" : "false")
                }
                className="accent-primary mt-0.5"
              />
              <div>
                <span className="text-text-secondary text-xs">Send anonymous crash reports</span>
                <p className="text-text-ghost mt-0.5 text-[10px]">
                  Only error stack traces. No code or personal data.
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* About */}
        <section className="border-border bg-bg-raised mt-8 rounded-lg border p-4">
          <h2 className="text-text-primary text-sm font-semibold">About</h2>
          <p className="text-text-tertiary mt-1 font-mono text-xs">Dispatch v0.0.1</p>
          <p className="text-text-tertiary mt-0.5 text-xs">
            CI/CD-integrated desktop PR review app.
          </p>
        </section>
      </div>
    </div>
  );
}
