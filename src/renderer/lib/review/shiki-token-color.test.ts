import { describe, expect, it } from "vitest";

import { getShikiTokenColor } from "./highlighter";

describe("getShikiTokenColor", () => {
  it("returns token.color when no htmlStyle", () => {
    expect(getShikiTokenColor({ content: "x", color: "#ff0000" }, "dark")).toBe("#ff0000");
    expect(getShikiTokenColor({ content: "x", color: "#ff0000" }, "light")).toBe("#ff0000");
  });

  it("returns undefined when no color and no htmlStyle", () => {
    expect(getShikiTokenColor({ content: "x" }, "dark")).toBeUndefined();
  });

  it("returns --shiki-dark in dark mode when available", () => {
    expect(
      getShikiTokenColor(
        { content: "x", color: "#aaa", htmlStyle: { color: "#bbb", "--shiki-dark": "#ccc" } },
        "dark",
      ),
    ).toBe("#ccc");
  });

  it("falls back to htmlStyle.color in dark mode when no --shiki-dark", () => {
    expect(
      getShikiTokenColor({ content: "x", color: "#aaa", htmlStyle: { color: "#bbb" } }, "dark"),
    ).toBe("#bbb");
  });

  it("falls back to token.color in dark mode when htmlStyle has no relevant keys", () => {
    expect(getShikiTokenColor({ content: "x", color: "#aaa", htmlStyle: {} }, "dark")).toBe("#aaa");
  });

  it("returns htmlStyle.color in light mode", () => {
    expect(
      getShikiTokenColor(
        { content: "x", color: "#aaa", htmlStyle: { color: "#bbb", "--shiki-dark": "#ccc" } },
        "light",
      ),
    ).toBe("#bbb");
  });

  it("falls back to token.color in light mode when htmlStyle.color is undefined", () => {
    expect(getShikiTokenColor({ content: "x", color: "#aaa", htmlStyle: {} }, "light")).toBe(
      "#aaa",
    );
  });
});
