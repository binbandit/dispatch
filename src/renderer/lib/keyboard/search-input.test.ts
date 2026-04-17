import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
import { describe, expect, it, vi } from "vite-plus/test";

describe("handleSearchInputEscape", () => {
  it("blurs the focused search input on Escape", () => {
    const blur = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onEscape = vi.fn();

    const handled = handleSearchInputEscape(
      {
        currentTarget: { blur } as unknown as HTMLInputElement,
        key: "Escape",
        preventDefault,
        stopPropagation,
      },
      { onEscape, stopPropagation: true },
    );

    expect(handled).toBeTruthy();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("ignores non-Escape keys", () => {
    const blur = vi.fn();
    const preventDefault = vi.fn();

    const handled = handleSearchInputEscape({
      currentTarget: { blur } as unknown as HTMLInputElement,
      key: "Enter",
      preventDefault,
      stopPropagation: vi.fn(),
    });

    expect(handled).toBeFalsy();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(blur).not.toHaveBeenCalled();
  });
});
