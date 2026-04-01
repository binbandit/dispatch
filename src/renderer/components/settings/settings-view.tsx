/* eslint-disable import/max-dependencies -- SettingsView intentionally composes several settings panes and helpers. */
import type { AiProvider } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useTheme } from "@/renderer/lib/app/theme-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  DEFAULT_KEYBINDINGS,
  type ShortcutCategory,
} from "@/renderer/lib/keyboard/keybinding-registry";
import {
  AI_MODEL_SLOT_SCOPED_PREFERENCE_KEYS,
  AI_PROVIDER_SCOPED_PREFERENCE_KEYS,
  AI_TASK_DEFINITIONS,
  AI_TASK_SLOT_SCOPED_PREFERENCE_KEYS,
  DEFAULT_AI_TASK_SLOT,
  getAiProviderModelOptions,
  LEGACY_AI_PREFERENCE_KEYS,
  getAiModelSlotPreferenceKey,
  getAiProviderPreferenceKey,
  getAiTaskSlotPreferenceKey,
  normalizeAiTaskSlot,
} from "@/shared/ai-provider-settings";
import {
  DEFAULT_PR_FETCH_LIMIT,
  PR_FETCH_LIMIT_OPTIONS,
  PR_FETCH_LIMIT_PREFERENCE_KEY,
  normalizePrFetchLimit,
} from "@/shared/pr-fetch-limit";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  GitMerge,
  Info,
  Keyboard,
  Palette,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { BotSettings } from "./bot-settings";
import { KeyRecorder } from "./key-recorder";
import {
  AI_PROVIDER_LIST,
  AiModelSlotCard,
  AiProviderRow,
  AiTaskRoutingRow,
  formatCheckedAgo,
  formatProviderVersion,
  formatTaskList,
  getBaseUrlPlaceholder,
  getBinaryPathPlaceholder,
  getDefaultAiBaseUrl,
  getDefaultAiBinaryPath,
  getHomePathPlaceholder,
  getProviderLabel,
  normalizeAiProvider,
  resolveProviderDotClass,
} from "./settings-ai-parts";
import {
  CODE_THEMES_DARK,
  CODE_THEMES_LIGHT,
  CodeThemeCard,
  CodeThemePreview,
  THEME_OPTIONS,
} from "./settings-code-theme";

/**
 * Settings panel — persists all values via preferences IPC.
 *
 * Keys: mergeStrategy, prPollInterval, checksPollInterval, prFetchLimit
 */

const PREF_KEYS = [
  "mergeStrategy",
  "prPollInterval",
  "checksPollInterval",
  PR_FETCH_LIMIT_PREFERENCE_KEY,
  "aiEnabled",
  LEGACY_AI_PREFERENCE_KEYS.provider,
  LEGACY_AI_PREFERENCE_KEYS.model,
  LEGACY_AI_PREFERENCE_KEYS.binaryPath,
  LEGACY_AI_PREFERENCE_KEYS.homePath,
  "analytics-opted-in",
  "crash-reports-opted-in",
  "aiApiKey",
  LEGACY_AI_PREFERENCE_KEYS.baseUrl,
  ...AI_PROVIDER_SCOPED_PREFERENCE_KEYS,
  ...AI_MODEL_SLOT_SCOPED_PREFERENCE_KEYS,
  ...AI_TASK_SLOT_SCOPED_PREFERENCE_KEYS,
  "botTitleTags",
  "botUsernames",
  "defaultDiffView",
  "defaultFileNav",
  "displayNameFormat",
  "aiAutoSuggest",
];

const NAV_SECTIONS_BASE = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "general", label: "General", icon: GitMerge },
  { id: "bots", label: "Bots", icon: Bot },
  { id: "ai", label: "AI Models", icon: Sparkles },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "about", label: "About", icon: Info },
] as const;

type SectionId = (typeof NAV_SECTIONS_BASE)[number]["id"];

const KEYBINDING_CATEGORIES: ShortcutCategory[] = ["Navigation", "Actions", "Search", "Views"];

interface AiProviderTestState {
  kind: "success" | "error";
  message: string;
}

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
  const aiProvidersQuery = useQuery({
    queryKey: ["ai", "providersStatus"],
    queryFn: () => ipc("ai.providersStatus"),
    staleTime: 15_000,
    refetchInterval: 15_000,
    enabled: aiEnabled,
  });
  const mergeStrategy = prefs.mergeStrategy ?? "squash";
  const prPollInterval = prefs.prPollInterval ?? "30";
  const checksPollInterval = prefs.checksPollInterval ?? "10";
  const prFetchLimit = String(
    normalizePrFetchLimit(prefs[PR_FETCH_LIMIT_PREFERENCE_KEY] ?? String(DEFAULT_PR_FETCH_LIMIT)),
  );
  const defaultDiffView = prefs.defaultDiffView ?? "unified";
  const defaultFileNav = prefs.defaultFileNav ?? "auto";
  const displayNameFormat = prefs.displayNameFormat ?? "name";

  const navSections = useMemo(
    () => (aiEnabled ? NAV_SECTIONS_BASE : NAV_SECTIONS_BASE.filter((s) => s.id !== "ai")),
    [aiEnabled],
  );
  const envAiVars = useMemo(
    () =>
      [
        ...(aiConfig
          ? Object.values(aiConfig.providers).flatMap((providerConfig) => [
              providerConfig.modelSource === "environment" ? providerConfig.modelEnvVar : null,
              providerConfig.binaryPathSource === "environment"
                ? providerConfig.binaryPathEnvVar
                : null,
              providerConfig.homePathSource === "environment"
                ? providerConfig.homePathEnvVar
                : null,
              providerConfig.baseUrlSource === "environment" ? providerConfig.baseUrlEnvVar : null,
            ])
          : []),
        ...(aiConfig
          ? Object.values(aiConfig.slots).flatMap((slotConfig) => [
              slotConfig.providerSource === "environment" ? slotConfig.providerEnvVar : null,
              slotConfig.modelSource === "environment" ? slotConfig.modelEnvVar : null,
            ])
          : []),
      ].filter(
        (value, index, values): value is string =>
          Boolean(value) && values.indexOf(value) === index,
      ),
    [aiConfig],
  );
  const aiProviderStatusById = useMemo(
    () => new Map((aiProvidersQuery.data ?? []).map((status) => [status.provider, status])),
    [aiProvidersQuery.data],
  );
  const [expandedAiProvider, setExpandedAiProvider] = useState<AiProvider | null>(null);
  const [providerTestState, setProviderTestState] = useState<
    Partial<Record<AiProvider, AiProviderTestState>>
  >({});
  const taskSlotById = useMemo(
    () =>
      Object.fromEntries(
        AI_TASK_DEFINITIONS.map((task) => [
          task.id,
          normalizeAiTaskSlot(prefs[getAiTaskSlotPreferenceKey(task.id)]) ??
            DEFAULT_AI_TASK_SLOT[task.id],
        ]),
      ) as Record<(typeof AI_TASK_DEFINITIONS)[number]["id"], "big" | "small">,
    [prefs],
  );
  const tasksBySlot = useMemo(
    () => ({
      big: AI_TASK_DEFINITIONS.filter((task) => taskSlotById[task.id] === "big"),
      small: AI_TASK_DEFINITIONS.filter((task) => taskSlotById[task.id] === "small"),
    }),
    [taskSlotById],
  );
  const checkedAgoLabel = aiProvidersQuery.isError
    ? "Provider check failed"
    : formatCheckedAgo(aiProvidersQuery.dataUpdatedAt);

  const saveMutation = useMutation({
    mutationFn: async (args: { key: string; value: string }) => {
      await ipc("preferences.set", args);
    },
    onSuccess: (_, args) => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
      queryClient.invalidateQueries({ queryKey: ["ai"] });
      if (args.key === PR_FETCH_LIMIT_PREFERENCE_KEY) {
        queryClient.invalidateQueries({ queryKey: ["pr"] });
      }
    },
  });

  function savePref(key: string, value: string) {
    saveMutation.mutate({ key, value });
  }
  const providerTestMutation = useMutation({
    mutationFn: async (args: {
      provider: AiProvider;
      model: string;
      binaryPath?: string;
      homePath?: string;
      baseUrl?: string;
    }) => {
      const response = await ipc("ai.test", args);
      return {
        provider: args.provider,
        response,
      };
    },
    onMutate: (args) => {
      setProviderTestState((current) => ({
        ...current,
        [args.provider]: undefined,
      }));
    },
    onSuccess: ({ provider, response }) => {
      setProviderTestState((current) => ({
        ...current,
        [provider]: {
          kind: "success",
          message: response,
        },
      }));
      queryClient.invalidateQueries({ queryKey: ["ai", "providersStatus"] });
    },
    onError: (error, args) => {
      setProviderTestState((current) => ({
        ...current,
        [args.provider]: {
          kind: "error",
          message: error instanceof Error ? error.message : "Provider test failed.",
        },
      }));
      queryClient.invalidateQueries({ queryKey: ["ai", "providersStatus"] });
    },
  });

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
    queryClient.invalidateQueries({ queryKey: ["pr"] });
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

  const contentMaxWidthClass = activeSection === "ai" ? "max-w-[980px]" : "max-w-lg";

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
        <div className={contentMaxWidthClass}>
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

              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Pull Request Fetch Size</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  How many pull requests Dispatch asks GitHub for on each refresh.
                </p>
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {PR_FETCH_LIMIT_OPTIONS.map((option) => {
                    const isActive = prFetchLimit === String(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => savePref(PR_FETCH_LIMIT_PREFERENCE_KEY, String(option))}
                        className={`cursor-pointer rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                          isActive
                            ? "text-text-primary border-[--border-accent] bg-[--accent-muted] shadow-sm"
                            : "border-border bg-bg-raised text-text-tertiary hover:text-text-secondary hover:bg-[--bg-elevated]"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                <div className="border-border bg-bg-raised mt-3 flex items-start gap-2 rounded-md border px-3 py-2">
                  <Info
                    size={12}
                    className="text-accent-text mt-0.5 shrink-0"
                  />
                  <p className="text-text-ghost text-[10px] leading-[1.45]">
                    Higher limits show more pull requests per refresh, but each fetch can take
                    longer.
                  </p>
                </div>
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
                {aiEnabled && (
                  <label className="mt-3 flex cursor-pointer items-center justify-between">
                    <div>
                      <span className="text-text-secondary text-xs">
                        Auto-suggest review comments
                      </span>
                      <p className="text-text-ghost mt-0.5 text-[10px]">
                        Automatically suggest review comments as you navigate through files.
                      </p>
                    </div>
                    <Switch
                      checked={prefs.aiAutoSuggest === "true"}
                      onCheckedChange={(checked) =>
                        savePref("aiAutoSuggest", checked ? "true" : "false")
                      }
                    />
                  </label>
                )}
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
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-text-primary text-base font-semibold">AI Models</h2>
                  <p className="text-text-tertiary mt-0.5 text-xs">
                    Route each AI workflow to an explicit big or small model slot, then configure
                    the local providers those slots use.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-text-ghost font-mono text-[10px]">{checkedAgoLabel}</span>
                  <button
                    type="button"
                    onClick={() => aiProvidersQuery.refetch()}
                    className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors"
                    aria-label="Refresh provider status"
                  >
                    <RefreshCw
                      size={13}
                      className={aiProvidersQuery.isFetching ? "animate-spin" : ""}
                    />
                  </button>
                </div>
              </div>
              {envAiVars.length > 0 && (
                <p className="text-text-tertiary mt-1 font-mono text-[10px]">
                  Using {envAiVars.join(", ")} from the environment. Saved settings override these
                  values.
                </p>
              )}
              <section className="mt-6">
                <h3 className="text-text-primary text-sm font-medium">Task Routing</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  Choose whether each AI workflow uses the big or small slot.
                </p>
                <div className="border-border mt-3 overflow-hidden rounded-xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0)),radial-gradient(circle_at_top_left,rgba(212,136,58,0.05),transparent_44%)] shadow-sm">
                  {AI_TASK_DEFINITIONS.map((task, index) => {
                    const selectedSlot = taskSlotById[task.id];
                    const resolvedTask = aiConfig?.tasks[task.id];

                    return (
                      <AiTaskRoutingRow
                        key={task.id}
                        label={task.label}
                        description={task.description}
                        selectedSlot={selectedSlot}
                        resolvedProviderLabel={getProviderLabel(resolvedTask?.provider)}
                        resolvedModel={resolvedTask?.model ?? null}
                        hasDivider={index > 0}
                        onSelectSlot={(slot) => savePref(getAiTaskSlotPreferenceKey(task.id), slot)}
                      />
                    );
                  })}
                </div>
              </section>

              <section className="mt-8">
                <h3 className="text-text-primary text-sm font-medium">Model Slots</h3>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  Each slot chooses a provider and model. Tasks above can point to either slot.
                </p>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  {(["big", "small"] as const).map((slot) => {
                    const providerPreferenceKey = getAiModelSlotPreferenceKey(slot, "provider");
                    const modelPreferenceKey = getAiModelSlotPreferenceKey(slot, "model");
                    const rawProviderPreference = prefs[providerPreferenceKey];
                    const hasExplicitProviderPreference =
                      typeof rawProviderPreference === "string" &&
                      rawProviderPreference.trim().length > 0;
                    const normalizedProviderPreference = normalizeAiProvider(rawProviderPreference);
                    const slotConfig = aiConfig?.slots[slot];
                    const slotProvider = hasExplicitProviderPreference
                      ? normalizedProviderPreference === "none"
                        ? null
                        : normalizedProviderPreference
                      : (slotConfig?.provider ?? null);
                    const rawModelPreference = prefs[modelPreferenceKey];
                    const hasExplicitModelPreference =
                      typeof rawModelPreference === "string" &&
                      rawModelPreference.trim().length > 0;
                    const resolvedSlotModel =
                      slotConfig?.model ??
                      (typeof rawModelPreference === "string" ? rawModelPreference : "");
                    const slotProviderConfig =
                      slotProvider === null ? null : (aiConfig?.providers[slotProvider] ?? null);
                    const providerModelOptions = slotProvider
                      ? getAiProviderModelOptions(
                          slotProvider,
                          resolvedSlotModel,
                          slotProviderConfig?.suggestedModels,
                        )
                      : [];
                    const slotTaskLabels = tasksBySlot[slot].map((task) => task.label);
                    const slotHelperText =
                      slotProvider === null
                        ? "Choose a provider for this slot."
                        : hasExplicitModelPreference
                          ? "Saved specifically for this slot."
                          : slotConfig?.modelSource === "environment" && slotConfig.modelEnvVar
                            ? `Using ${slotConfig.modelEnvVar}.`
                            : slotConfig?.modelSource === "default"
                              ? `Using the default ${slot} model for ${getProviderLabel(slotProvider)}.`
                              : "Inheriting the provider or legacy model until you override this slot.";

                    return (
                      <AiModelSlotCard
                        key={slot}
                        slot={slot}
                        provider={slotProvider}
                        model={resolvedSlotModel}
                        helperText={slotHelperText}
                        usageText={`Used by ${formatTaskList(slotTaskLabels)}.`}
                        providerModelOptions={[...providerModelOptions]}
                        onSelectProvider={(provider) =>
                          savePref(providerPreferenceKey, provider ?? "none")
                        }
                        onChangeModel={(value) => savePref(modelPreferenceKey, value)}
                        onSelectModel={(value) => savePref(modelPreferenceKey, value)}
                      />
                    );
                  })}
                </div>
              </section>

              <section className="mt-8">
                <p className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
                  Providers
                </p>
                <div className="border-border mt-3 overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_top_left,rgba(212,136,58,0.07),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] shadow-sm">
                  {AI_PROVIDER_LIST.map((provider, index) => {
                    const status = aiProviderStatusById.get(provider.id);
                    const isExpanded = expandedAiProvider === provider.id;
                    const binaryPathPreferenceKey = getAiProviderPreferenceKey(
                      provider.id,
                      "binaryPath",
                    );
                    const homePathPreferenceKey = getAiProviderPreferenceKey(
                      provider.id,
                      "homePath",
                    );
                    const baseUrlPreferenceKey = getAiProviderPreferenceKey(provider.id, "baseUrl");
                    const providerConfig = aiConfig?.providers[provider.id];
                    const providerBinaryPathValue = binaryPathPreferenceKey
                      ? (prefs[binaryPathPreferenceKey] ?? "")
                      : "";
                    const providerHomePathValue = homePathPreferenceKey
                      ? (prefs[homePathPreferenceKey] ?? "")
                      : "";
                    const providerBaseUrlValue = baseUrlPreferenceKey
                      ? (prefs[baseUrlPreferenceKey] ?? "")
                      : "";
                    const providerTestFeedback = providerTestState[provider.id];
                    const isTestingProvider =
                      providerTestMutation.isPending &&
                      providerTestMutation.variables?.provider === provider.id;
                    const slotBadges = [
                      aiConfig?.slots.big.provider === provider.id ? "Big" : null,
                      aiConfig?.slots.small.provider === provider.id ? "Small" : null,
                    ].filter(Boolean) as string[];
                    const providerTestModel =
                      (aiConfig?.slots.big.provider === provider.id
                        ? aiConfig.slots.big.model
                        : null) ??
                      (aiConfig?.slots.small.provider === provider.id
                        ? aiConfig.slots.small.model
                        : null) ??
                      providerConfig?.model ??
                      "";

                    return (
                      <AiProviderRow
                        key={provider.id}
                        label={provider.label}
                        version={formatProviderVersion(status?.version ?? null)}
                        statusText={status?.statusText ?? "Checking availability"}
                        dotClass={resolveProviderDotClass(status)}
                        isExpanded={isExpanded}
                        hasDivider={index > 0}
                        badges={slotBadges}
                        onToggleExpanded={() =>
                          setExpandedAiProvider((current) =>
                            current === provider.id ? null : provider.id,
                          )
                        }
                      >
                        <div className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            {provider.id === "ollama" ? (
                              <label className="flex flex-col gap-1.5">
                                <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
                                  Base URL
                                </span>
                                <input
                                  type="text"
                                  value={providerBaseUrlValue}
                                  onChange={(e) => {
                                    if (baseUrlPreferenceKey) {
                                      savePref(baseUrlPreferenceKey, e.target.value);
                                    }
                                  }}
                                  placeholder={getBaseUrlPlaceholder(provider.id, providerConfig)}
                                  className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
                                />
                                <p className="text-text-ghost text-[10px]">
                                  Leave blank to use {getDefaultAiBaseUrl(provider.id)}.
                                </p>
                              </label>
                            ) : (
                              <label className="flex flex-col gap-1.5">
                                <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
                                  Binary Path
                                </span>
                                <input
                                  type="text"
                                  value={providerBinaryPathValue}
                                  onChange={(e) => {
                                    if (binaryPathPreferenceKey) {
                                      savePref(binaryPathPreferenceKey, e.target.value);
                                    }
                                  }}
                                  placeholder={getBinaryPathPlaceholder(
                                    provider.id,
                                    providerConfig,
                                  )}
                                  className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
                                />
                                <p className="text-text-ghost text-[10px]">
                                  Leave blank to use {getDefaultAiBinaryPath(provider.id)} from
                                  PATH.
                                </p>
                              </label>
                            )}
                            {provider.id === "codex" && (
                              <label className="flex flex-col gap-1.5 md:col-span-2">
                                <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
                                  Codex Home
                                </span>
                                <input
                                  type="text"
                                  value={providerHomePathValue}
                                  onChange={(e) => {
                                    if (homePathPreferenceKey) {
                                      savePref(homePathPreferenceKey, e.target.value);
                                    }
                                  }}
                                  placeholder={getHomePathPlaceholder(providerConfig)}
                                  className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
                                />
                              </label>
                            )}
                          </div>
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-1">
                              <p className="text-text-secondary max-w-xl text-[11px] leading-[1.6]">
                                {provider.description}
                              </p>
                              <p className="text-text-ghost text-[10px]">{provider.hint}</p>
                              <p className="text-text-ghost text-[10px]">
                                Models for this provider are chosen in the big and small slot cards
                                above.
                              </p>
                              {providerTestFeedback && !isTestingProvider && (
                                <div
                                  className={cn(
                                    "mt-2 inline-flex max-w-xl items-start gap-2 rounded-md border px-2.5 py-2 text-[10px] leading-[1.5]",
                                    providerTestFeedback.kind === "success"
                                      ? "border-[rgba(61,214,140,0.28)] bg-[rgba(61,214,140,0.08)] text-[--success]"
                                      : "border-[rgba(255,107,107,0.24)] bg-[rgba(255,107,107,0.08)] text-[--danger]",
                                  )}
                                >
                                  {providerTestFeedback.kind === "success" ? (
                                    <Check
                                      size={12}
                                      className="mt-0.5 shrink-0"
                                    />
                                  ) : (
                                    <TriangleAlert
                                      size={12}
                                      className="mt-0.5 shrink-0"
                                    />
                                  )}
                                  <span className="font-mono">{providerTestFeedback.message}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 self-start">
                              <button
                                type="button"
                                onClick={() =>
                                  providerTestMutation.mutate({
                                    provider: provider.id,
                                    model: providerTestModel,
                                    binaryPath: providerBinaryPathValue || undefined,
                                    homePath: providerHomePathValue || undefined,
                                    baseUrl: providerBaseUrlValue || undefined,
                                  })
                                }
                                disabled={
                                  providerTestMutation.isPending || providerTestModel.length === 0
                                }
                                className="text-text-secondary hover:text-text-primary hover:bg-bg-raised inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[--border] px-3 py-2 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60"
                              >
                                {isTestingProvider ? (
                                  <Spinner className="h-3.5 w-3.5" />
                                ) : (
                                  <Sparkles size={12} />
                                )}
                                {isTestingProvider ? "Testing…" : "Test"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </AiProviderRow>
                    );
                  })}
                </div>
              </section>
              {aiProvidersQuery.isError && (
                <p className="text-danger mt-2 text-[11px]">
                  Failed to refresh provider status. Check your local installs and try again.
                </p>
              )}
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
