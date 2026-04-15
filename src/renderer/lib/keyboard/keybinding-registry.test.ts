import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_KEYBINDINGS_MAP,
  formatKeybinding,
  resolveBinding,
  type KeybindingOverrides,
} from "@/renderer/lib/keyboard/keybinding-registry";
import { describe, expect, it, vi } from "vite-plus/test";

describe("DEFAULT_KEYBINDINGS", () => {
  it("contains all expected shortcuts", () => {
    expect(DEFAULT_KEYBINDINGS.length).toBeGreaterThan(0);
  });

  it("all shortcuts have required properties", () => {
    for (const binding of DEFAULT_KEYBINDINGS) {
      expect(binding).toHaveProperty("id");
      expect(binding).toHaveProperty("key");
      expect(binding).toHaveProperty("label");
      expect(binding).toHaveProperty("category");
      expectTypeOf(binding.id).toBeString();
      expectTypeOf(binding.key).toBeString();
      expectTypeOf(binding.label).toBeString();
      expectTypeOf(binding.category).toBeString();
    }
  });

  it("all shortcut IDs are unique", () => {
    const ids = DEFAULT_KEYBINDINGS.map((b) => b.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("contains navigation shortcuts", () => {
    const navShortcuts = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Navigation");
    expect(navShortcuts.length).toBeGreaterThan(0);
    expect(navShortcuts.some((s) => s.id === "navigation.prevPr")).toBeTruthy();
    expect(navShortcuts.some((s) => s.id === "navigation.nextPr")).toBeTruthy();
  });

  it("contains action shortcuts", () => {
    const actionShortcuts = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Actions");
    expect(actionShortcuts.length).toBeGreaterThan(0);
  });

  it("contains search shortcuts", () => {
    const searchShortcuts = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Search");
    expect(searchShortcuts.length).toBeGreaterThan(0);
    expect(searchShortcuts.some((s) => s.id === "search.focusSearch")).toBeTruthy();
  });

  it("contains view shortcuts", () => {
    const viewShortcuts = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Views");
    expect(viewShortcuts.length).toBeGreaterThan(0);
  });
});

describe("DEFAULT_KEYBINDINGS_MAP", () => {
  it("is a Map with all keybindings", () => {
    expect(DEFAULT_KEYBINDINGS_MAP).toBeInstanceOf(Map);
    expect(DEFAULT_KEYBINDINGS_MAP.size).toBe(DEFAULT_KEYBINDINGS.length);
  });

  it("can retrieve bindings by id", () => {
    const binding = DEFAULT_KEYBINDINGS_MAP.get("navigation.prevPr");
    expect(binding).toBeDefined();
    expect(binding?.key).toBe("j");
  });

  it("returns undefined for unknown ids", () => {
    const binding = DEFAULT_KEYBINDINGS_MAP.get("unknown.id");
    expect(binding).toBeUndefined();
  });
});

describe("resolveBinding", () => {
  it("returns default binding when no override exists", () => {
    const overrides: KeybindingOverrides = {};
    const binding = resolveBinding("navigation.prevPr", overrides);

    expect(binding.key).toBe("j");
    expect(binding.modifiers).toBeUndefined();
  });

  it("returns override when one exists", () => {
    const overrides: KeybindingOverrides = {
      "navigation.prevPr": { key: "p", modifiers: ["meta"] },
    };
    const binding = resolveBinding("navigation.prevPr", overrides);

    expect(binding.key).toBe("p");
    expect(binding.modifiers).toEqual(["meta"]);
  });

  it("returns empty key for unknown shortcut", () => {
    const overrides: KeybindingOverrides = {};
    const binding = resolveBinding("unknown.shortcut", overrides);

    expect(binding.key).toBe("");
  });

  it("preserves modifiers from default binding", () => {
    const overrides: KeybindingOverrides = {};
    const binding = resolveBinding("navigation.toggleSidebar", overrides);

    expect(binding.key).toBe("b");
    expect(binding.modifiers).toEqual(["meta"]);
  });

  it("override can change key and modifiers", () => {
    const overrides: KeybindingOverrides = {
      "navigation.toggleSidebar": { key: "s", modifiers: ["meta", "shift"] },
    };
    const binding = resolveBinding("navigation.toggleSidebar", overrides);

    expect(binding.key).toBe("s");
    expect(binding.modifiers).toEqual(["meta", "shift"]);
  });

  it("override can remove modifiers", () => {
    const overrides: KeybindingOverrides = {
      "navigation.toggleSidebar": { key: "b" },
    };
    const binding = resolveBinding("navigation.toggleSidebar", overrides);

    expect(binding.key).toBe("b");
    expect(binding.modifiers).toBeUndefined();
  });
});

describe("formatKeybinding", () => {
  describe("Mac platform", () => {
    it("formats simple key", () => {
      const result = formatKeybinding("j");
      expect(result).toBe("J");
    });

    it("formats key with meta modifier on Mac", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("k", ["meta"]);
      expect(result).toContain("⌘");
      expect(result).toContain("K");
      vi.unstubAllGlobals();
    });

    it("formats key with shift modifier on Mac", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("?", ["shift"]);
      expect(result).toContain("⇧");
      vi.unstubAllGlobals();
    });

    it("formats key with multiple modifiers on Mac", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("k", ["meta", "shift"]);
      expect(result).toContain("⌘");
      expect(result).toContain("⇧");
      expect(result).toContain("K");
      vi.unstubAllGlobals();
    });
  });

  describe("non-Mac platform", () => {
    // Note: stubGlobal doesn't affect the module-level navigator access in keybinding-registry
    // These tests document the expected behavior but may not work in unit tests
    it.skip("formats meta as Ctrl on non-Mac", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });
      const result = formatKeybinding("k", ["meta"]);
      expect(result).toContain("Ctrl");
      expect(result).toContain("K");
      vi.unstubAllGlobals();
    });

    it.skip("formats shift as Shift on non-Mac", () => {
      vi.stubGlobal("navigator", { platform: "Linux" });
      const result = formatKeybinding("?", ["shift"]);
      expect(result).toContain("Shift");
      vi.unstubAllGlobals();
    });

    it.skip("formats alt as Alt on non-Mac", () => {
      vi.stubGlobal("navigator", { platform: "Win32" });
      const result = formatKeybinding("x", ["alt"]);
      expect(result).toContain("Alt");
      expect(result).toContain("X");
      vi.unstubAllGlobals();
    });
  });

  describe("special keys", () => {
    it("formats Enter as symbol", () => {
      const result = formatKeybinding("Enter");
      expect(result).toBe("⏎");
    });

    it("formats Escape as Esc", () => {
      const result = formatKeybinding("Escape");
      expect(result).toBe("Esc");
    });

    it("formats arrow keys as symbols", () => {
      expect(formatKeybinding("ArrowUp")).toBe("↑");
      expect(formatKeybinding("ArrowDown")).toBe("↓");
      expect(formatKeybinding("ArrowLeft")).toBe("←");
      expect(formatKeybinding("ArrowRight")).toBe("→");
    });

    it("formats space as Space", () => {
      const result = formatKeybinding(" ");
      expect(result).toBe("Space");
    });

    it("formats Backspace as symbol", () => {
      const result = formatKeybinding("Backspace");
      expect(result).toBe("⌫");
    });

    it("formats Delete as symbol", () => {
      const result = formatKeybinding("Delete");
      expect(result).toBe("⌦");
    });

    it("formats Tab as symbol", () => {
      const result = formatKeybinding("Tab");
      expect(result).toBe("⇥");
    });
  });

  describe("complex keybindings", () => {
    it("formats command palette shortcut", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("k", ["meta"]);
      expect(result).toMatch(/⌘.*K/);
      vi.unstubAllGlobals();
    });

    it("formats multi-modifier shortcut", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("|", ["meta", "shift"]);
      expect(result).toMatch(/⌘.*⇧.*\|/);
      vi.unstubAllGlobals();
    });

    it("maintains modifier order", () => {
      vi.stubGlobal("navigator", { platform: "MacIntel" });
      const result = formatKeybinding("k", ["meta", "shift", "alt"]);
      const parts = [...result];
      const metaIndex = parts.indexOf("⌘");
      const shiftIndex = parts.indexOf("⇧");
      const altIndex = parts.indexOf("⌥");
      expect(metaIndex).toBeLessThan(shiftIndex);
      expect(shiftIndex).toBeLessThan(altIndex);
      vi.unstubAllGlobals();
    });
  });

  describe("single character keys", () => {
    it("uppercases single character keys", () => {
      expect(formatKeybinding("a")).toBe("A");
      expect(formatKeybinding("z")).toBe("Z");
      expect(formatKeybinding("1")).toBe("1");
    });

    it("preserves special characters", () => {
      expect(formatKeybinding("/")).toBe("/");
      expect(formatKeybinding("?")).toBe("?");
      expect(formatKeybinding("|")).toBe("|");
      expect(formatKeybinding("[")).toBe("[");
      expect(formatKeybinding("]")).toBe("]");
    });
  });

  describe("multi-character keys", () => {
    it("preserves multi-character key names", () => {
      expect(formatKeybinding("Enter")).toBe("⏎");
      expect(formatKeybinding("Escape")).toBe("Esc");
      expect(formatKeybinding("F1")).toBe("F1");
    });
  });
});

describe("shortcut categories", () => {
  it("Navigation category contains expected shortcuts", () => {
    const nav = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Navigation");
    const ids = nav.map((b) => b.id);

    expect(ids).toContain("navigation.prevPr");
    expect(ids).toContain("navigation.nextPr");
    expect(ids).toContain("navigation.openPr");
    expect(ids).toContain("navigation.nextRegion");
    expect(ids).toContain("navigation.prevRegion");
    expect(ids).toContain("navigation.prevFile");
    expect(ids).toContain("navigation.nextFile");
    expect(ids).toContain("navigation.focusFiles");
    expect(ids).toContain("navigation.focusDiff");
    expect(ids).toContain("navigation.toggleSidebar");
    expect(ids).toContain("navigation.prevHunk");
    expect(ids).toContain("navigation.nextHunk");
  });

  it("Actions category contains expected shortcuts", () => {
    const actions = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Actions");
    const ids = actions.map((b) => b.id);

    expect(ids).toContain("actions.togglePanel");
    expect(ids).toContain("actions.togglePanelAlternate");
    expect(ids).toContain("actions.openOverview");
    expect(ids).toContain("actions.openConversation");
    expect(ids).toContain("actions.openCommits");
    expect(ids).toContain("actions.openChecks");
    expect(ids).toContain("actions.focusPanel");
    expect(ids).toContain("actions.focusReviewBar");
    expect(ids).toContain("actions.toggleViewed");
    expect(ids).toContain("actions.nextUnreviewed");
    expect(ids).toContain("actions.nextUnresolvedThread");
    expect(ids).toContain("actions.replyToThread");
    expect(ids).toContain("actions.resolveThread");
    expect(ids).toContain("actions.requestChanges");
    expect(ids).toContain("actions.approve");
    expect(ids).toContain("actions.merge");
    expect(ids).toContain("actions.closePanel");
    expect(ids).toContain("actions.nextComment");
    expect(ids).toContain("actions.prevComment");
  });

  it("Search category contains expected shortcuts", () => {
    const search = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Search");
    const ids = search.map((b) => b.id);

    expect(ids).toContain("search.focusSearch");
    expect(ids).toContain("search.commandPalette");
  });

  it("Views category contains expected shortcuts", () => {
    const views = DEFAULT_KEYBINDINGS.filter((b) => b.category === "Views");
    const ids = views.map((b) => b.id);

    expect(ids).toContain("views.review");
    expect(ids).toContain("views.workflows");
    expect(ids).toContain("views.metrics");
    expect(ids).toContain("views.releases");
    expect(ids).toContain("views.settings");
  });
});

describe("real-world usage", () => {
  it("resolves all default shortcuts without errors", () => {
    const overrides: KeybindingOverrides = {};

    for (const shortcut of DEFAULT_KEYBINDINGS) {
      const binding = resolveBinding(shortcut.id, overrides);
      expect(binding.key).toBeTruthy();
    }
  });

  it("formats all default shortcuts without errors", () => {
    for (const shortcut of DEFAULT_KEYBINDINGS) {
      const formatted = formatKeybinding(shortcut.key, shortcut.modifiers);
      expect(formatted).toBeTruthy();
      expectTypeOf(formatted).toBeString();
    }
  });

  it("handles user customization scenario", () => {
    const overrides: KeybindingOverrides = {
      "navigation.prevPr": { key: "ArrowUp" },
      "navigation.nextPr": { key: "ArrowDown" },
      "search.commandPalette": { key: "p", modifiers: ["ctrl", "shift"] },
    };

    const prevPr = resolveBinding("navigation.prevPr", overrides);
    const nextPr = resolveBinding("navigation.nextPr", overrides);
    const cmdPalette = resolveBinding("search.commandPalette", overrides);

    expect(prevPr.key).toBe("ArrowUp");
    expect(nextPr.key).toBe("ArrowDown");
    expect(cmdPalette.key).toBe("p");
    expect(cmdPalette.modifiers).toEqual(["ctrl", "shift"]);
  });
});

describe("modifier combinations", () => {
  it("supports meta modifier", () => {
    const binding = DEFAULT_KEYBINDINGS.find((b) => b.modifiers?.includes("meta"));
    expect(binding).toBeDefined();
  });

  it("supports shift modifier", () => {
    const binding = DEFAULT_KEYBINDINGS.find((b) => b.modifiers?.includes("shift"));
    expect(binding).toBeDefined();
  });

  it("supports multiple modifiers", () => {
    const binding = DEFAULT_KEYBINDINGS.find((b) => b.modifiers && b.modifiers.length > 1);
    expect(binding).toBeDefined();
  });

  it("uses deliberate modifier combos for dangerous review actions", () => {
    const approve = DEFAULT_KEYBINDINGS_MAP.get("actions.approve");
    const requestChanges = DEFAULT_KEYBINDINGS_MAP.get("actions.requestChanges");
    const merge = DEFAULT_KEYBINDINGS_MAP.get("actions.merge");

    expect(approve?.modifiers).toEqual(["meta", "shift"]);
    expect(requestChanges?.modifiers).toEqual(["meta", "shift"]);
    expect(merge?.modifiers).toEqual(["meta", "shift"]);
  });

  it("supports an alternate modified panel toggle shortcut", () => {
    const togglePanelAlternate = DEFAULT_KEYBINDINGS_MAP.get("actions.togglePanelAlternate");

    expect(togglePanelAlternate?.key).toBe("\\");
    expect(togglePanelAlternate?.modifiers).toEqual(["meta"]);
  });
});
