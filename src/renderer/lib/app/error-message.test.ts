import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./error-message";

describe("getErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(getErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("extracts message from Error subclass", () => {
    expect(getErrorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("converts string to itself", () => {
    expect(getErrorMessage("raw string error")).toBe("raw string error");
  });

  it("converts number to string", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  it("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(getErrorMessage()).toBe("undefined");
  });

  it("converts object to string", () => {
    expect(getErrorMessage({ code: "FAIL" })).toBe("[object Object]");
  });
});
