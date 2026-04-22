import { describe, expect, it } from "vitest";

import { getExternalUrl } from "./external-links";

describe("getExternalUrl", () => {
  it("accepts http URLs", () => {
    expect(getExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("accepts https URLs", () => {
    expect(getExternalUrl("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
  });

  it("preserves query params and fragments", () => {
    const url = "https://example.com/path?q=1#section";
    expect(getExternalUrl(url)).toBe(url);
  });

  it("rejects javascript: protocol", () => {
    expect(getExternalUrl(`java${"script"}:alert(1)`)).toBeNull();
  });

  it("rejects file: protocol", () => {
    expect(getExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects ftp: protocol", () => {
    expect(getExternalUrl("ftp://files.example.com")).toBeNull();
  });

  it("rejects data: protocol", () => {
    expect(getExternalUrl("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(getExternalUrl("not a url")).toBeNull();
    expect(getExternalUrl("")).toBeNull();
  });
});
