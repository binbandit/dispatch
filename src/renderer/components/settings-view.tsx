import { Spinner } from "@/components/ui/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";

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

export function SettingsView() {
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
