import { applyMarkdownFormat } from "@/renderer/lib/review/markdown-format";
import { describe, expect, it } from "vitest";

describe("applyMarkdownFormat", () => {
  it("wraps the selected text for bold formatting", () => {
    expect(applyMarkdownFormat("ship this", { start: 0, end: 4 }, "bold")).toStrictEqual({
      value: "**ship** this",
      selection: { start: 2, end: 6 },
    });
  });

  it("inserts a code block placeholder when nothing is selected", () => {
    expect(applyMarkdownFormat("", { start: 0, end: 0 }, "code-block")).toStrictEqual({
      value: "```\ncode\n```",
      selection: { start: 4, end: 8 },
    });
  });

  it("prefixes every selected line for numbered lists", () => {
    expect(
      applyMarkdownFormat("first\nsecond", { start: 0, end: 12 }, "numbered-list"),
    ).toStrictEqual({
      value: "1. first\n2. second",
      selection: { start: 0, end: 18 },
    });
  });

  it("creates a link and selects the url when text is already selected", () => {
    expect(applyMarkdownFormat("Dispatch", { start: 0, end: 8 }, "link")).toStrictEqual({
      value: "[Dispatch](https://)",
      selection: { start: 11, end: 19 },
    });
  });
});
