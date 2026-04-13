import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { normalizeValue } from "./normalize-value";

type EnvMap = Record<string, string | undefined>;

interface ClaudeSettingsFile {
  model?: unknown;
  availableModels?: unknown;
}

function pushUniqueModel(models: string[], value: unknown): void {
  const normalizedValue = normalizeValue(value);

  if (!normalizedValue || models.includes(normalizedValue)) {
    return;
  }

  models.push(normalizedValue);
}

function readClaudeSettingsContent(env: EnvMap): string | null {
  const homePath = normalizeValue(env.HOME) ?? homedir();

  try {
    return readFileSync(join(homePath, ".claude", "settings.json"), "utf8");
  } catch {
    return null;
  }
}

function parseClaudeSettings(content: string | null | undefined): ClaudeSettingsFile | null {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? (parsed as ClaudeSettingsFile) : null;
  } catch {
    return null;
  }
}

export function resolveClaudeSuggestedModels(
  env: EnvMap = process.env,
  options: {
    settingsContent?: string | null;
  } = {},
): string[] {
  const settings = parseClaudeSettings(
    options.settingsContent === undefined
      ? readClaudeSettingsContent(env)
      : options.settingsContent,
  );
  const suggestedModels: string[] = [];

  pushUniqueModel(suggestedModels, settings?.model);

  if (Array.isArray(settings?.availableModels)) {
    if (settings.availableModels.length === 0) {
      if (suggestedModels.length === 0) {
        pushUniqueModel(suggestedModels, "default");
      }
      return suggestedModels;
    }

    for (const model of settings.availableModels) {
      pushUniqueModel(suggestedModels, model);
    }

    return suggestedModels;
  }

  pushUniqueModel(suggestedModels, env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  pushUniqueModel(suggestedModels, env.ANTHROPIC_DEFAULT_HAIKU_MODEL);

  return suggestedModels;
}
