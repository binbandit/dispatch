export const TOP_BAR_VISIBLE_TABS_PREFERENCE_KEY = "topBarVisibleTabs";
export const TOP_BAR_LABEL_MODE_PREFERENCE_KEY = "topBarLabelMode";

export const OPTIONAL_TOP_BAR_TABS = ["metrics", "releases"] as const;
export const TOP_BAR_LABEL_MODES = ["icon-only", "icon-and-text"] as const;

export type OptionalTopBarTab = (typeof OPTIONAL_TOP_BAR_TABS)[number];
export type TopBarLabelMode = (typeof TOP_BAR_LABEL_MODES)[number];

const DEFAULT_VISIBLE_TOP_BAR_TABS = [...OPTIONAL_TOP_BAR_TABS];
const DEFAULT_TOP_BAR_LABEL_MODE = "icon-and-text";

export function getVisibleTopBarTabs(value?: string | null): OptionalTopBarTab[] {
  if (!value) {
    return DEFAULT_VISIBLE_TOP_BAR_TABS;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return DEFAULT_VISIBLE_TOP_BAR_TABS;
    }

    const normalized = OPTIONAL_TOP_BAR_TABS.filter((tab) => parsed.includes(tab));
    if (parsed.length > 0 && normalized.length === 0) {
      return DEFAULT_VISIBLE_TOP_BAR_TABS;
    }

    return normalized;
  } catch {
    return DEFAULT_VISIBLE_TOP_BAR_TABS;
  }
}

export function serializeVisibleTopBarTabs(visibleTabs: readonly OptionalTopBarTab[]): string {
  return JSON.stringify(OPTIONAL_TOP_BAR_TABS.filter((tab) => visibleTabs.includes(tab)));
}

export function setTopBarTabVisibility(
  visibleTabs: readonly OptionalTopBarTab[],
  tab: OptionalTopBarTab,
  visible: boolean,
): OptionalTopBarTab[] {
  const nextVisibleTabs = new Set(visibleTabs);

  if (visible) {
    nextVisibleTabs.add(tab);
  } else {
    nextVisibleTabs.delete(tab);
  }

  return OPTIONAL_TOP_BAR_TABS.filter((candidate) => nextVisibleTabs.has(candidate));
}

export function getTopBarLabelMode(value?: string | null): TopBarLabelMode {
  if (value === "icon-only" || value === "icon-and-text") {
    return value;
  }

  return DEFAULT_TOP_BAR_LABEL_MODE;
}
