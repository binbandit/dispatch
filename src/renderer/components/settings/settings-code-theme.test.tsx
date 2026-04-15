import { describe, expect, it } from "vite-plus/test";

import { getColorModeOptions, getThemeStyleOptions } from "./settings-code-theme";

describe("getThemeStyleOptions", () => {
  it("returns only the supported default style", () => {
    expect(getThemeStyleOptions().map((o) => o.value)).toEqual(["default"]);
  });
});

describe("getColorModeOptions", () => {
  it("returns dark, light, system when oled is disabled", () => {
    expect(getColorModeOptions(false).map((o) => o.value)).toEqual(["dark", "light", "system"]);
  });

  it("inserts oled after dark when enabled", () => {
    expect(getColorModeOptions(true).map((o) => o.value)).toEqual([
      "dark",
      "oled",
      "light",
      "system",
    ]);
  });
});
