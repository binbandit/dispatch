import type { Highlighter } from "shiki";

import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  GitMerge,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_BOT_USERNAMES, parseJsonArray } from "../hooks/use-bot-settings";
import { ensureTheme, getHighlighter } from "../lib/highlighter";
import { ipc } from "../lib/ipc";
import { useKeybindings } from "../lib/keybinding-context";
import { DEFAULT_KEYBINDINGS, type ShortcutCategory } from "../lib/keybinding-registry";
import { queryClient } from "../lib/query-client";
import { useTheme } from "../lib/theme-context";
import { KeyRecorder } from "./key-recorder";

/**
 * Settings panel — persists all values via preferences IPC.
 *
 * Keys: mergeStrategy, prPollInterval, checksPollInterval
 */

const PREF_KEYS = [
  "mergeStrategy",
  "prPollInterval",
  "checksPollInterval",
  "aiEnabled",
  "aiProvider",
  "aiModel",
  "analytics-opted-in",
  "crash-reports-opted-in",
  "aiApiKey",
  "aiBaseUrl",
  "botTitleTags",
  "botUsernames",
  "defaultDiffView",
  "defaultFileNav",
  "displayNameFormat",
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
      className="[&_code]:!font-mono [&_pre]:!rounded-md [&_pre]:!border [&_pre]:!border-[--border] [&_pre]:!p-3 [&_pre]:!text-[12.5px] [&_pre]:!leading-[20px]"
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
      <div className="flex shrink-0 items-center gap-1">
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
      {isActive && (
        <Check
          size={13}
          className="shrink-0 text-[--accent-text]"
        />
      )}
    </button>
  );
}

const NAV_SECTIONS_BASE = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "general", label: "General", icon: GitMerge },
  { id: "bots", label: "Bots", icon: Bot },
  { id: "ai", label: "AI Provider", icon: Sparkles },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "about", label: "About", icon: Info },
] as const;

type SectionId = (typeof NAV_SECTIONS_BASE)[number]["id"];

const KEYBINDING_CATEGORIES: ShortcutCategory[] = ["Navigation", "Actions", "Search", "Views"];

export function SettingsView() {
  const { theme, setTheme, resolvedTheme, codeTheme, setCodeTheme } = useTheme();
  const { getBinding, setBinding, resetBinding, resetAll, overrides } = useKeybindings();
  const [activeSection, setActiveSection] = useState<SectionId>("appearance");

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
  const aiEnabled = prefs.aiEnabled === "true";
  const mergeStrategy = prefs.mergeStrategy ?? "squash";
  const prPollInterval = prefs.prPollInterval ?? "30";
  const checksPollInterval = prefs.checksPollInterval ?? "10";
  const defaultDiffView = prefs.defaultDiffView ?? "unified";
  const defaultFileNav = prefs.defaultFileNav ?? "auto";
  const displayNameFormat = prefs.displayNameFormat ?? "name";

  const navSections = useMemo(
    () => (aiEnabled ? NAV_SECTIONS_BASE : NAV_SECTIONS_BASE.filter((s) => s.id !== "ai")),
    [aiEnabled],
  );
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

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showNukeConfirm, setShowNukeConfirm] = useState(false);
  const [nukeConfirmText, setNukeConfirmText] = useState("");

  const resetDefaults = useCallback(async () => {
    await ipc("preferences.deleteMany", { keys: PREF_KEYS });
    setTheme("dark");
    setCodeTheme("github-dark-default");
    resetAll();
    queryClient.invalidateQueries({ queryKey: ["preferences"] });
    queryClient.invalidateQueries({ queryKey: ["ai"] });
    setShowResetConfirm(false);
  }, [setTheme, setCodeTheme, resetAll]);

  const nukeApp = useCallback(async () => {
    localStorage.clear();
    await ipc("app.nuke");
  }, []);

  if (prefsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Side navigation */}
      <nav className="border-border flex w-[200px] shrink-0 flex-col border-r py-6">
        <h1 className="font-heading text-text-primary px-5 text-2xl font-bold italic">Settings</h1>
        <div className="mt-4 flex flex-col gap-0.5 px-2">
          {navSections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs transition-all duration-[--duration-fast] ${
                activeSection === id
                  ? "text-text-primary border-l-2 border-[--accent] bg-[--accent-muted]"
                  : "text-text-secondary hover:text-text-primary border-l-2 border-transparent hover:bg-[--bg-raised]"
              }`}
            >
              <Icon
                size={14}
                className={activeSection === id ? "text-[--accent-text]" : ""}
              />
              {label}
            </button>
          ))}
        </div>
        <div className="mt-auto px-2 pt-4">
          {showResetConfirm ? (
            <div className="border-border bg-bg-raised flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center gap-1.5">
                <TriangleAlert
                  size={12}
                  className="text-[--warning]"
                />
                <span className="text-text-primary text-[11px] font-medium">
                  Reset all settings?
                </span>
              </div>
              <p className="text-text-tertiary text-[10px]">
                This will restore all preferences, keybindings, and themes to their defaults.
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={resetDefaults}
                  className="text-text-primary flex-1 cursor-pointer rounded-md bg-[--danger] px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-90"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="border-border text-text-secondary hover:text-text-primary flex-1 cursor-pointer rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-[--bg-elevated]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-text-tertiary hover:text-text-secondary flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-[--bg-raised]"
            >
              <RotateCcw size={14} />
              Reset to defaults
            </button>
          )}
        </div>
      </nav>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-lg">
          {activeSection === "appearance" && (
            <>
              <h2 className="text-text-primary text-base font-semibold">Appearance</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                Customize the look and feel of Dispatch.
              </p>

              {/* App Theme */}
              <section className="mt-6">
                <h3 className="text-text-primary text-sm font-medium">App Theme</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  Choose your preferred color theme.
                </p>
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
                <h3 className="text-text-primary text-sm font-medium">Code Theme</h3>
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
                  <label className="text-text-tertiary mb-1.5 block font-mono text-[10px] font-medium tracking-wider uppercase">
                    Preview
                  </label>
                  <CodeThemePreview themeId={codeTheme} />
                </div>
              </section>
            </>
          )}

          {activeSection === "keybindings" && (
            <>
              <h2 className="text-text-primary text-base font-semibold">Keyboard Shortcuts</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                Customize keyboard shortcuts. Click a binding to record a new key.
              </p>

              {KEYBINDING_CATEGORIES.map((category) => (
                <section
                  key={category}
                  className="mt-6"
                >
                  <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
                    {category}
                  </h3>
                  <div className="flex flex-col gap-1">
                    {DEFAULT_KEYBINDINGS.filter((def) => def.category === category).map((def) => {
                      const binding = getBinding(def.id);
                      const isCustomized = def.id in overrides;
                      return (
                        <div
                          key={def.id}
                          className="flex items-center justify-between py-1.5"
                        >
                          <span className="text-text-secondary text-xs">{def.label}</span>
                          <KeyRecorder
                            currentKey={binding.key}
                            currentModifiers={binding.modifiers}
                            isCustomized={isCustomized}
                            onRecord={(key, modifiers) => setBinding(def.id, key, modifiers)}
                            onReset={() => resetBinding(def.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              {Object.keys(overrides).length > 0 && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-text-tertiary hover:text-text-secondary mt-6 flex cursor-pointer items-center gap-1.5 text-xs transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset all to defaults
                </button>
              )}
            </>
          )}

          {activeSection === "general" && (
            <>
              <h2 className="text-text-primary text-base font-semibold">General</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                Configure merge behavior and polling intervals.
              </p>

              {/* Merge strategy */}
              <section className="mt-6">
                <h3 className="text-text-primary text-sm font-medium">Default Merge Strategy</h3>
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

              {/* Default diff view */}
              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Default Diff View</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  How diffs are displayed when reviewing files.
                </p>
                <div className="border-border bg-bg-raised mt-3 flex rounded-md border p-[2px]">
                  {(["unified", "split", "full-file"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => savePref("defaultDiffView", s)}
                      className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-xs capitalize ${
                        defaultDiffView === s
                          ? "bg-bg-elevated text-text-primary shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                    >
                      {s === "full-file" ? "Full file" : s}
                    </button>
                  ))}
                </div>
              </section>

              {/* Default file navigation */}
              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Default File Navigation</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  How files are organized in the review sidebar.
                </p>
                <div className="border-border bg-bg-raised mt-3 flex rounded-md border p-[2px]">
                  {(
                    [
                      { value: "auto", label: "Auto" },
                      { value: "triage", label: "Triage" },
                      { value: "tree", label: "Tree" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => savePref("defaultFileNav", value)}
                      className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-xs ${
                        defaultFileNav === value
                          ? "bg-bg-elevated text-text-primary shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-text-ghost mt-1.5 text-[10px]">
                  Auto uses triage for PRs with more than 5 files, tree otherwise.
                </p>
              </section>

              {/* Display Name Format */}
              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Name Display</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  Show usernames or real names for PR authors and committers.
                </p>
                <div className="border-border bg-bg-raised mt-3 flex rounded-md border p-[2px]">
                  {(
                    [
                      { value: "name", label: "Real Name" },
                      { value: "login", label: "Username" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => savePref("displayNameFormat", value)}
                      className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-xs ${
                        displayNameFormat === value
                          ? "bg-bg-elevated text-text-primary shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-text-ghost mt-1.5 text-[10px]">
                  Falls back to username when a real name is unavailable.
                </p>
              </section>

              {/* Polling intervals */}
              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Polling Intervals</h3>
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

              {/* AI toggle */}
              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">AI Features</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  Enable AI-powered summaries, explanations, and failure analysis.
                </p>
                <label className="mt-3 flex cursor-pointer items-center justify-between">
                  <span className="text-text-secondary text-xs">Use AI</span>
                  <Switch
                    checked={aiEnabled}
                    onCheckedChange={(checked) => savePref("aiEnabled", checked ? "true" : "false")}
                  />
                </label>
              </section>
            </>
          )}

          {activeSection === "bots" && (
            <BotSettings
              prefs={prefs}
              savePref={savePref}
            />
          )}

          {activeSection === "ai" && aiEnabled && (
            <>
              <h2 className="text-text-primary text-base font-semibold">AI Provider</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                Configure an AI provider for code explanations and PR summaries.
              </p>
              {envAiVars.length > 0 && (
                <p className="text-text-tertiary mt-1 font-mono text-[10px]">
                  Using {envAiVars.join(", ")} from the environment. Saved settings override these
                  values. Select None to disable AI in Dispatch.
                </p>
              )}
              <div className="mt-4 flex flex-col gap-3">
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
            </>
          )}

          {activeSection === "privacy" && (
            <>
              <h2 className="text-text-primary text-base font-semibold">Privacy</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                All data stays on your machine. These optional settings help improve Dispatch.
              </p>
              <div className="mt-4 flex flex-col gap-3">
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
                      We track which features are used, not what you review. No code, file paths, or
                      PR content.
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
                    <span className="text-text-secondary text-xs">
                      Send anonymous crash reports
                    </span>
                    <p className="text-text-ghost mt-0.5 text-[10px]">
                      Only error stack traces. No code or personal data.
                    </p>
                  </div>
                </label>
              </div>
            </>
          )}

          {activeSection === "about" && (
            <>
              <h2 className="text-text-primary text-base font-semibold">About</h2>
              <p className="text-text-tertiary mt-0.5 text-xs">
                Information about your Dispatch installation.
              </p>
              <section className="border-border bg-bg-raised mt-4 rounded-lg border p-4">
                <p className="text-text-tertiary font-mono text-xs">Dispatch v0.0.1</p>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  CI/CD-integrated desktop PR review app.
                </p>
              </section>

              {/* Danger Zone */}
              <section className="mt-10">
                <h3 className="text-sm font-medium text-[--danger]">Danger Zone</h3>
                <div className="mt-3 rounded-lg border border-[--danger]/30">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-text-primary text-xs font-medium">
                        Reset Dispatch to factory defaults
                      </p>
                      <p className="text-text-tertiary mt-0.5 text-[11px]">
                        Deletes all data — workspaces, review progress, preferences, notifications,
                        and caches. This cannot be undone.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNukeConfirm(true);
                        setNukeConfirmText("");
                      }}
                      className="ml-4 shrink-0 cursor-pointer rounded-md border border-[--danger]/30 px-3 py-1.5 text-xs font-medium text-[--danger] transition-colors hover:bg-[--danger-muted]"
                    >
                      Reset everything
                    </button>
                  </div>
                </div>
              </section>

              {/* Nuke confirmation modal */}
              {showNukeConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div
                    className="absolute inset-0 bg-black/60"
                    onClick={() => setShowNukeConfirm(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setShowNukeConfirm(false);
                      }
                    }}
                  />
                  <div className="bg-bg-root border-border relative z-10 w-full max-w-sm rounded-lg border p-6 shadow-xl">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[--danger-muted]">
                        <Trash2
                          size={16}
                          className="text-[--danger]"
                        />
                      </div>
                      <h3 className="text-text-primary text-sm font-semibold">Reset Dispatch?</h3>
                    </div>
                    <p className="text-text-secondary mt-3 text-xs leading-relaxed">
                      This will permanently delete <strong>all</strong> app data and restart
                      Dispatch:
                    </p>
                    <ul className="text-text-tertiary mt-2 flex flex-col gap-1 text-[11px]">
                      <li className="flex items-center gap-1.5">
                        <span className="text-[--danger]">-</span> All workspaces and repo accounts
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-[--danger]">-</span> Review progress and viewed files
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-[--danger]">-</span> Preferences, themes, and
                        keybindings
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-[--danger]">-</span> Notifications and cached data
                      </li>
                    </ul>
                    <div className="mt-4">
                      <label className="text-text-tertiary block text-[11px]">
                        Type <span className="text-text-primary font-mono font-medium">RESET</span>{" "}
                        to confirm
                      </label>
                      <input
                        type="text"
                        value={nukeConfirmText}
                        onChange={(e) => setNukeConfirmText(e.target.value)}
                        placeholder="RESET"
                        autoFocus
                        className="border-border bg-bg-raised text-text-primary placeholder:text-text-ghost mt-1.5 w-full rounded-md border px-3 py-1.5 font-mono text-xs tracking-wider focus:border-[--danger]/50 focus:outline-none"
                      />
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={nukeConfirmText !== "RESET"}
                        onClick={nukeApp}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[--danger] px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                        Reset everything
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNukeConfirm(false)}
                        className="border-border text-text-secondary hover:text-text-primary hover:bg-bg-raised flex-1 cursor-pointer rounded-md border px-3 py-1.5 text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot settings section
// ---------------------------------------------------------------------------

function BotSettings({
  prefs,
  savePref,
}: {
  prefs: Record<string, string | null>;
  savePref: (key: string, value: string) => void;
}) {
  const botTitleTags = useMemo(
    () => parseJsonArray(prefs.botTitleTags ?? null),
    [prefs.botTitleTags],
  );
  const botUsernames = useMemo(
    () => parseJsonArray(prefs.botUsernames ?? null),
    [prefs.botUsernames],
  );

  return (
    <>
      <h2 className="text-text-primary text-base font-semibold">Bots</h2>
      <p className="text-text-tertiary mt-0.5 text-xs">
        Configure how automated and bot activity is detected and displayed.
      </p>

      {/* Title tags */}
      <section className="mt-6">
        <h3 className="text-text-primary text-sm font-medium">PR Title Tags</h3>
        <p className="text-text-tertiary mt-0.5 text-xs">
          PRs with these tags in their title will be flagged as bot/automated PRs.
        </p>
        <TagInput
          tags={botTitleTags}
          onChange={(tags) => savePref("botTitleTags", JSON.stringify(tags))}
          placeholder="e.g. [bot], [auto], [dependabot]"
        />
      </section>

      {/* Bot usernames */}
      <section className="mt-8">
        <h3 className="text-text-primary text-sm font-medium">Bot Usernames</h3>
        <p className="text-text-tertiary mt-0.5 text-xs">
          Comments from these users will be styled as bot comments.
        </p>
        <TagInput
          tags={botUsernames}
          onChange={(tags) => savePref("botUsernames", JSON.stringify(tags))}
          placeholder="e.g. my-org-bot, deploy-bot"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-text-ghost text-[10px]">Built-in:</span>
          {DEFAULT_BOT_USERNAMES.map((name) => (
            <span
              key={name}
              className="bg-bg-raised text-text-tertiary rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
            >
              {name}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tag input with chips
// ---------------------------------------------------------------------------

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag(value: string) {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  return (
    <div className="border-border bg-bg-root focus-within:border-border-strong mt-2 flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
      {tags.map((tag, i) => (
        <span
          key={tag}
          className="bg-accent-muted text-accent-text border-border-accent inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="text-text-tertiary hover:text-text-primary cursor-pointer"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            e.preventDefault();
            addTag(input);
          }
          if (e.key === "Backspace" && !input && tags.length > 0) {
            removeTag(tags.length - 1);
          }
        }}
        onBlur={() => {
          if (input.trim()) addTag(input);
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="text-text-primary placeholder:text-text-tertiary min-w-[80px] flex-1 bg-transparent text-xs focus:outline-none"
      />
    </div>
  );
}
