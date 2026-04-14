import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const BOT_AUTO_COLLAPSE_PREFERENCE_KEY = "autoCollapseBotUsernames";

const BOT_PREF_KEYS = ["botTitleTags", "botUsernames", BOT_AUTO_COLLAPSE_PREFERENCE_KEY];

/** Regex patterns that always match bot usernames (not configurable). */
const DEFAULT_BOT_PATTERNS = [/\[bot\]$/i, /-bot$/i];

/** Usernames always treated as bots (users can add more via settings). */
export const DEFAULT_BOT_USERNAMES = [
  "dependabot",
  "renovate",
  "codecov",
  "vercel",
  "github-actions",
  "copilot",
  "coderabbit",
  "macroscopeapp",
];

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function useBotSettings() {
  const prefsQuery = useQuery({
    queryKey: ["preferences", BOT_PREF_KEYS],
    queryFn: () => ipc("preferences.getAll", { keys: BOT_PREF_KEYS }),
    staleTime: 60_000,
  });

  const prefs = prefsQuery.data ?? {};
  const customUsernames = useMemo(() => parseJsonArray(prefs.botUsernames), [prefs.botUsernames]);
  const titleTags = useMemo(() => parseJsonArray(prefs.botTitleTags), [prefs.botTitleTags]);
  const autoCollapseUsernames = useMemo(
    () => parseJsonArray(prefs[BOT_AUTO_COLLAPSE_PREFERENCE_KEY]),
    [prefs[BOT_AUTO_COLLAPSE_PREFERENCE_KEY]],
  );

  const isBot = useMemo(() => {
    const allUsernames = [...DEFAULT_BOT_USERNAMES, ...customUsernames];
    const usernameSet = new Set(allUsernames.map((u) => u.toLowerCase()));

    return (login: string): boolean => {
      const lower = login.toLowerCase();
      if (usernameSet.has(lower)) {
        return true;
      }
      return DEFAULT_BOT_PATTERNS.some((p) => p.test(login));
    };
  }, [customUsernames]);

  const isBotPr = useMemo(
    () =>
      (title: string): boolean => {
        if (titleTags.length === 0) {
          return false;
        }
        const lower = title.toLowerCase();
        return titleTags.some((tag) => lower.includes(tag.toLowerCase()));
      },
    [titleTags],
  );

  const shouldAutoCollapseBot = useMemo(() => {
    const autoCollapseSet = new Set(
      autoCollapseUsernames.map((username) => username.toLowerCase()),
    );

    return (login: string): boolean => autoCollapseSet.has(login.toLowerCase());
  }, [autoCollapseUsernames]);

  return {
    isBot,
    isBotPr,
    titleTags,
    customUsernames,
    autoCollapseUsernames,
    shouldAutoCollapseBot,
  };
}
