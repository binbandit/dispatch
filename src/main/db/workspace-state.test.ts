import { describe, expect, it } from "vitest";

import { resolveActiveWorkspacePath, splitWorkspaceRows } from "./workspace-state";

describe("workspace-state", () => {
  it("splits valid and stale workspaces", () => {
    const rows = [
      { id: 1, path: "/repo/live", name: "live" },
      { id: 2, path: "/repo/stale", name: "stale" },
    ];

    const { staleRows, validRows } = splitWorkspaceRows(rows, (path) => path === "/repo/live");

    expect(validRows).toEqual([{ id: 1, path: "/repo/live", name: "live" }]);
    expect(staleRows).toEqual([{ id: 2, path: "/repo/stale", name: "stale" }]);
  });

  it("falls back to the first valid workspace when the active one is stale", () => {
    const workspaces = [{ path: "/repo/stale" }, { path: "/repo/live" }];

    expect(
      resolveActiveWorkspacePath("/repo/stale", workspaces, (path) => path === "/repo/live"),
    ).toBe("/repo/live");
  });
});
