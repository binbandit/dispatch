import {
  getTopBarLabelMode,
  getVisibleTopBarTabs,
  serializeVisibleTopBarTabs,
  setTopBarTabVisibility,
  TOP_BAR_LABEL_MODE_PREFERENCE_KEY,
  TOP_BAR_VISIBLE_TABS_PREFERENCE_KEY,
} from "@/shared/top-bar-tabs";
import { describe, expect, it } from "vitest";

describe("top bar tab preferences", () => {
  it("defaults to showing all optional tabs", () => {
    expect(getVisibleTopBarTabs()).toEqual(["metrics", "releases"]);
    expect(getVisibleTopBarTabs(null)).toEqual(["metrics", "releases"]);
  });

  it("parses stored tab visibility and allows hiding every optional tab", () => {
    expect(getVisibleTopBarTabs('["releases"]')).toEqual(["releases"]);
    expect(getVisibleTopBarTabs("[]")).toEqual([]);
  });

  it("falls back to defaults for malformed or unknown-only payloads", () => {
    expect(getVisibleTopBarTabs("not-json")).toEqual(["metrics", "releases"]);
    expect(getVisibleTopBarTabs('["unknown"]')).toEqual(["metrics", "releases"]);
  });

  it("updates tab visibility in canonical order", () => {
    expect(setTopBarTabVisibility(["releases"], "metrics", true)).toEqual(["metrics", "releases"]);
    expect(setTopBarTabVisibility(["metrics", "releases"], "metrics", false)).toEqual(["releases"]);
  });

  it("serializes visible tabs with a stable shape", () => {
    expect(serializeVisibleTopBarTabs(["releases", "metrics", "releases"])).toBe(
      '["metrics","releases"]',
    );
  });

  it("defaults top bar labels to icons and text", () => {
    expect(getTopBarLabelMode()).toBe("icon-and-text");
    expect(getTopBarLabelMode(null)).toBe("icon-and-text");
  });

  it("accepts either supported top bar label mode", () => {
    expect(getTopBarLabelMode("icon-only")).toBe("icon-only");
    expect(getTopBarLabelMode("icon-and-text")).toBe("icon-and-text");
  });

  it("falls back to the default label mode for unknown values", () => {
    expect(getTopBarLabelMode("compact")).toBe("icon-and-text");
  });

  it("exports the preference key", () => {
    expect(TOP_BAR_VISIBLE_TABS_PREFERENCE_KEY).toBe("topBarVisibleTabs");
    expect(TOP_BAR_LABEL_MODE_PREFERENCE_KEY).toBe("topBarLabelMode");
  });
});
