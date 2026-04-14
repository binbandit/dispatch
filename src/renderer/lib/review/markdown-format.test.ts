import { describe, expect, it } from "vitest";

import { applyMarkdownFormat } from "./markdown-format";

describe("applyMarkdownFormat", () => {
  describe("bold", () => {
    it("wraps selected text with **", () => {
      const result = applyMarkdownFormat("hello world", { start: 0, end: 5 }, "bold");
      expect(result.value).toBe("**hello** world");
    });

    it("inserts placeholder when no selection", () => {
      const result = applyMarkdownFormat("", { start: 0, end: 0 }, "bold");
      expect(result.value).toBe("**bold text**");
      expect(result.selection.start).toBe(2);
      expect(result.selection.end).toBe(11);
    });
  });

  describe("italic", () => {
    it("wraps selected text with _", () => {
      const result = applyMarkdownFormat("hello world", { start: 6, end: 11 }, "italic");
      expect(result.value).toBe("hello _world_");
    });

    it("inserts placeholder when no selection", () => {
      const result = applyMarkdownFormat("", { start: 0, end: 0 }, "italic");
      expect(result.value).toBe("_emphasis_");
    });
  });

  describe("inline-code", () => {
    it("wraps selected text with backticks", () => {
      const result = applyMarkdownFormat("use myFunc here", { start: 4, end: 10 }, "inline-code");
      expect(result.value).toBe("use `myFunc` here");
    });
  });

  describe("code-block", () => {
    it("wraps selection in fenced code block", () => {
      const result = applyMarkdownFormat("const x = 1;", { start: 0, end: 13 }, "code-block");
      expect(result.value).toBe("```\nconst x = 1;\n```");
    });
  });

  describe("link", () => {
    it("wraps selected text as markdown link and selects URL placeholder", () => {
      const result = applyMarkdownFormat("click here", { start: 0, end: 10 }, "link");
      expect(result.value).toBe("[click here](https://)");
      // URL placeholder should be selected
      expect(result.selection.start).toBe(13);
      expect(result.selection.end).toBe(21);
    });

    it("inserts placeholder link with no selection", () => {
      const result = applyMarkdownFormat("", { start: 0, end: 0 }, "link");
      expect(result.value).toBe("[link text](https://)");
      // Label text should be selected
      expect(result.selection.start).toBe(1);
      expect(result.selection.end).toBe(10);
    });
  });

  describe("blockquote", () => {
    it("prefixes selected lines with >", () => {
      const result = applyMarkdownFormat("line one\nline two", { start: 0, end: 17 }, "blockquote");
      expect(result.value).toBe("> line one\n> line two");
    });

    it("inserts placeholder when no selection", () => {
      const result = applyMarkdownFormat("", { start: 0, end: 0 }, "blockquote");
      expect(result.value).toBe("> Quoted note");
    });
  });

  describe("bullet-list", () => {
    it("prefixes selected lines with -", () => {
      const result = applyMarkdownFormat(
        "item one\nitem two",
        { start: 0, end: 17 },
        "bullet-list",
      );
      expect(result.value).toBe("- item one\n- item two");
    });
  });

  describe("numbered-list", () => {
    it("prefixes lines with sequential numbers", () => {
      const result = applyMarkdownFormat(
        "first\nsecond\nthird",
        { start: 0, end: 18 },
        "numbered-list",
      );
      expect(result.value).toBe("1. first\n2. second\n3. third");
    });
  });

  describe("task-list", () => {
    it("prefixes lines with checkbox syntax", () => {
      const result = applyMarkdownFormat("task one\ntask two", { start: 0, end: 17 }, "task-list");
      expect(result.value).toBe("- [ ] task one\n- [ ] task two");
    });
  });

  describe("edge cases", () => {
    it("handles selection at end of text", () => {
      const text = "hello";
      const result = applyMarkdownFormat(text, { start: 5, end: 5 }, "bold");
      expect(result.value).toBe("hello**bold text**");
    });

    it("handles mid-text insertion", () => {
      const result = applyMarkdownFormat("hello world", { start: 5, end: 5 }, "bold");
      expect(result.value).toBe("hello**bold text** world");
    });
  });
});
