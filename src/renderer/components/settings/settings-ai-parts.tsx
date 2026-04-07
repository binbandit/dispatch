/* eslint-disable import/max-dependencies -- These AI settings parts intentionally group provider cards and formatting helpers used only by SettingsView. */
import type { AiProvider, AiProviderStatus } from "@/shared/ipc";
import type { ReactNode } from "react";

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  DEFAULT_AI_BASE_URL_BY_PROVIDER,
  DEFAULT_AI_BINARY_PATH_BY_PROVIDER,
} from "@/shared/ai-provider-settings";
import { ChevronDown } from "lucide-react";

export function getDefaultAiBaseUrl(provider: string): string {
  return DEFAULT_AI_BASE_URL_BY_PROVIDER[provider as AiProvider] ?? "Default";
}

export function getDefaultAiBinaryPath(provider: string): string {
  return DEFAULT_AI_BINARY_PATH_BY_PROVIDER[provider as AiProvider] ?? "";
}

export function getProviderLabel(provider: AiProvider | null | undefined): string {
  return AI_PROVIDER_LIST.find((candidate) => candidate.id === provider)?.label ?? "Provider";
}

export function normalizeAiProvider(
  value: string | null | undefined,
): "codex" | "claude" | "copilot" | "ollama" | "opencode" | "none" {
  switch (value) {
    case "codex":
    case "claude":
    case "copilot":
    case "ollama":
    case "opencode":
    case "none": {
      return value;
    }
    default: {
      return "none";
    }
  }
}

export const AI_PROVIDER_LIST: Array<{
  id: AiProvider;
  label: string;
  description: string;
  hint: string;
}> = [
  {
    id: "codex",
    label: "Codex",
    description: "Local Codex CLI integration for OpenAI models and non-interactive review tasks.",
    hint: "Run codex login first. Dispatch uses codex exec in non-interactive mode.",
  },
  {
    id: "claude",
    label: "Claude",
    description:
      "Local Claude Code integration for Anthropic models across summaries, explanations, and review flows.",
    hint: "Run claude auth login first. Dispatch uses claude -p with tools disabled.",
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "GitHub Copilot CLI integration for GitHub-backed models and review suggestions.",
    hint: "Install `copilot` or `gh copilot` first. Dispatch uses Copilot CLI print mode with read-only tools.",
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Local Ollama runtime integration over HTTP for self-hosted models.",
    hint: "Dispatch talks directly to the local Ollama daemon over HTTP.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description:
      "OpenCode CLI integration — provider-agnostic agent supporting Anthropic, OpenAI, Google, and more.",
    hint: "Install via brew install opencode. Models use provider/model format (e.g. anthropic/claude-sonnet-4-20250514).",
  },
];

export function formatCheckedAgo(timestamp: number): string {
  if (timestamp <= 0) {
    return "Checking now";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return `Checked ${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `Checked ${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Checked ${elapsedHours}h ago`;
}

export function resolveProviderDotClass(status: AiProviderStatus | undefined): string {
  if (!status) {
    return "bg-text-ghost";
  }

  if (status.authenticated === null) {
    return status.available ? "bg-info shadow-[0_0_12px_rgba(91,164,230,0.25)]" : "bg-danger";
  }

  if (status.authenticated) {
    return "bg-success shadow-[0_0_12px_rgba(61,214,140,0.28)]";
  }

  return status.available ? "bg-warning" : "bg-danger";
}

export function formatProviderVersion(version: string | null): string | null {
  return version ? `v${version}` : null;
}

export function formatTaskList(items: string[]): string {
  if (items.length === 0) {
    return "No tasks";
  }

  if (items.length === 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

export function getBinaryPathPlaceholder(
  provider: AiProvider,
  providerConfig:
    | {
        binaryPath: string | null;
        binaryPathSource: string;
        binaryPathEnvVar: string | null;
      }
    | undefined,
): string {
  if (providerConfig?.binaryPathSource === "environment" && providerConfig.binaryPathEnvVar) {
    return `Using ${providerConfig.binaryPathEnvVar}`;
  }

  return providerConfig?.binaryPath ?? getDefaultAiBinaryPath(provider);
}

export function getHomePathPlaceholder(
  providerConfig:
    | {
        homePath: string | null;
        homePathSource: string;
        homePathEnvVar: string | null;
      }
    | undefined,
): string {
  if (providerConfig?.homePathSource === "environment" && providerConfig.homePathEnvVar) {
    return `Using ${providerConfig.homePathEnvVar}`;
  }

  return providerConfig?.homePath ?? "Optional";
}

export function getBaseUrlPlaceholder(
  provider: AiProvider,
  providerConfig:
    | {
        baseUrl: string | null;
        baseUrlSource: string;
        baseUrlEnvVar: string | null;
      }
    | undefined,
): string {
  if (providerConfig?.baseUrlSource === "environment" && providerConfig.baseUrlEnvVar) {
    return `Using ${providerConfig.baseUrlEnvVar}`;
  }

  return providerConfig?.baseUrl ?? getDefaultAiBaseUrl(provider);
}

export function AiProviderRow({
  label,
  version,
  statusText,
  dotClass,
  isExpanded,
  hasDivider,
  badges,
  onToggleExpanded,
  children,
}: {
  label: string;
  version: string | null;
  statusText: string;
  dotClass: string;
  isExpanded: boolean;
  hasDivider: boolean;
  badges: string[];
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={isExpanded}>
      <div className={cn(hasDivider && "border-border border-t")}>
        <div className="flex items-center gap-3 px-5 py-5">
          <span className={cn("h-3 w-3 shrink-0 rounded-full", dotClass)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-text-primary text-[16px] font-semibold tracking-[-0.02em]">
                {label}
              </span>
              {version && (
                <span className="text-text-tertiary font-mono text-[11px]">{version}</span>
              )}
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-[--border-accent] bg-[--accent-muted] px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-[--accent-text] uppercase"
                >
                  {badge}
                </span>
              ))}
            </div>
            <p className="text-text-secondary mt-1 text-[11px] leading-[1.5]">{statusText}</p>
          </div>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md transition-colors"
            aria-label={`Toggle ${label} settings`}
          >
            <ChevronDown
              size={15}
              className={cn(
                "transition-transform duration-[--duration-fast]",
                isExpanded && "rotate-180",
              )}
            />
          </button>
        </div>
        <CollapsibleContent className="border-border-subtle border-t">
          <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.01),rgba(255,255,255,0)),radial-gradient(circle_at_top_left,rgba(212,136,58,0.05),transparent_55%)] px-5 py-4">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function AiTaskRoutingRow({
  label,
  description,
  selectedSlot,
  resolvedProviderLabel,
  resolvedModel,
  hasDivider,
  onSelectSlot,
}: {
  label: string;
  description: string;
  selectedSlot: "big" | "small";
  resolvedProviderLabel: string;
  resolvedModel: string | null;
  hasDivider: boolean;
  onSelectSlot: (slot: "big" | "small") => void;
}) {
  return (
    <div className={cn(hasDivider && "border-border border-t", "px-4 py-3")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-[13px] font-medium">{label}</span>
            <span className="text-text-ghost font-mono text-[10px]">
              {resolvedProviderLabel}
              {resolvedModel ? ` • ${resolvedModel}` : ""}
            </span>
          </div>
          <p className="text-text-tertiary mt-1 text-[11px] leading-[1.5]">{description}</p>
        </div>
        <div className="border-border bg-bg-raised flex rounded-md border p-[2px]">
          {(["small", "big"] as const).map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => onSelectSlot(slot)}
              className={cn(
                "cursor-pointer rounded-[4px] px-3 py-1.5 font-mono text-[10px] font-medium uppercase transition-colors",
                selectedSlot === slot
                  ? "bg-bg-elevated text-[--accent-text] shadow-sm"
                  : "text-text-tertiary hover:text-text-primary",
              )}
            >
              {slot}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AiModelSlotCard({
  slot,
  provider,
  model,
  helperText,
  usageText,
  providerModelOptions,
  onSelectProvider,
  onChangeModel,
  onSelectModel,
}: {
  slot: "big" | "small";
  provider: AiProvider | null;
  model: string;
  helperText: string;
  usageText: string;
  providerModelOptions: Array<{ label: string; value: string }>;
  onSelectProvider: (provider: AiProvider | null) => void;
  onChangeModel: (value: string) => void;
  onSelectModel: (value: string) => void;
}) {
  return (
    <div className="border-border overflow-hidden rounded-xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0)),radial-gradient(circle_at_top_left,rgba(212,136,58,0.06),transparent_44%)] shadow-sm">
      <div className="border-border-subtle border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-[14px] font-semibold tracking-[-0.02em]">
            {slot === "big" ? "Big model" : "Small model"}
          </span>
          <span className="rounded-full border border-[--border] px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-[--text-tertiary] uppercase">
            {slot}
          </span>
        </div>
        <p className="text-text-tertiary mt-1 text-[11px] leading-[1.5]">{usageText}</p>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div>
          <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
            Provider
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onSelectProvider(null)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors",
                provider === null
                  ? "border-[--border-accent] bg-[--accent-muted] text-[--accent-text]"
                  : "text-text-tertiary hover:text-text-primary hover:bg-bg-raised border-[--border]",
              )}
            >
              Off
            </button>
            {AI_PROVIDER_LIST.map((providerOption) => (
              <button
                key={providerOption.id}
                type="button"
                onClick={() => onSelectProvider(providerOption.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors",
                  provider === providerOption.id
                    ? "border-[--border-accent] bg-[--accent-muted] text-[--accent-text]"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-raised border-[--border]",
                )}
              >
                {providerOption.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
            Model
          </span>
          <input
            type="text"
            value={provider === null ? "" : model}
            onChange={(event) => onChangeModel(event.target.value)}
            disabled={provider === null}
            placeholder={provider === null ? "Select a provider first" : "Model name"}
            className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary rounded-md border px-3 py-2 font-mono text-xs focus:outline-none disabled:cursor-default disabled:opacity-50"
          />
          <p className="text-text-ghost text-[10px]">{helperText}</p>
        </label>

        {provider !== null && providerModelOptions.length > 0 && (
          <div>
            <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.08em] uppercase">
              Suggested models
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {providerModelOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSelectModel(option.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors",
                    model === option.value
                      ? "border-[--border-accent] bg-[--accent-muted] text-[--accent-text]"
                      : "text-text-tertiary hover:text-text-primary hover:bg-bg-raised border-[--border]",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
