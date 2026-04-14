import { describe, expect, it } from "vite-plus/test";

import { getThemeOptions } from "./settings-code-theme";

describe("getThemeOptions", () => {
  it("includes the oled theme when the experiment is enabled", () => {
    expect(getThemeOptions(true).map((option) => option.value)).toEqual([
      "dark",
      "oled",
      "light",
      "system",
    ]);
  });

  it("keeps the default theme list when the experiment is disabled", () => {
    expect(getThemeOptions(false).map((option) => option.value)).toEqual([
      "dark",
      "light",
      "system",
    ]);
  });
});
