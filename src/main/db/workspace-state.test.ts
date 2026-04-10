import { describe, expect, it } from "vitest";

import { splitWorkspaceRows } from "./workspace-state";

describe("workspace-state", () => {
  it("splits valid and stale workspaces", () => {
    const rows = [
      { id: 1, path: "/repo/live", name: "live" },
      { id: 2, path: "/repo/stale", name: "stale" },
    ];

    const { staleRows, validRows } = splitWorkspaceRows(
      rows,
      (path: string) => path === "/repo/live",
    );

    expect(validRows).toEqual([{ id: 1, path: "/repo/live", name: "live" }]);
    expect(staleRows).toEqual([{ id: 2, path: "/repo/stale", name: "stale" }]);
  });

  it("keeps remote-only workspaces (null path) as valid", () => {
    const rows = [
      { id: 1, path: null, name: "remote" },
      { id: 2, path: "/repo/stale", name: "stale" },
    ];

    const { staleRows, validRows } = splitWorkspaceRows(rows, () => false);

    expect(validRows).toEqual([{ id: 1, path: null, name: "remote" }]);
    expect(staleRows).toEqual([{ id: 2, path: "/repo/stale", name: "stale" }]);
  });
});
