import "@testing-library/jest-dom/vitest";
import { type Shortcut, useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function ShortcutHarness({ shortcuts }: { shortcuts: Shortcut[] }) {
  useKeyboardShortcuts(shortcuts);
  return <div>Harness</div>;
}

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a handler only after a full key sequence is entered", () => {
    const sequenceHandler = vi.fn();

    render(<ShortcutHarness shortcuts={[{ sequence: ["g", "q"], handler: sequenceHandler }]} />);

    fireEvent.keyDown(globalThis.window, { key: "g" });
    expect(sequenceHandler).not.toHaveBeenCalled();

    fireEvent.keyDown(globalThis.window, { key: "w" });
    expect(sequenceHandler).not.toHaveBeenCalled();

    fireEvent.keyDown(globalThis.window, { key: "g" });
    fireEvent.keyDown(globalThis.window, { key: "q" });

    expect(sequenceHandler).toHaveBeenCalledTimes(1);
  });

  it("expires pending key sequences after the timeout window", () => {
    vi.useFakeTimers();

    const sequenceHandler = vi.fn();

    render(<ShortcutHarness shortcuts={[{ sequence: ["g", "q"], handler: sequenceHandler }]} />);

    fireEvent.keyDown(globalThis.window, { key: "g" });
    vi.advanceTimersByTime(1201);
    fireEvent.keyDown(globalThis.window, { key: "q" });

    expect(sequenceHandler).not.toHaveBeenCalled();

    fireEvent.keyDown(globalThis.window, { key: "g" });
    fireEvent.keyDown(globalThis.window, { key: "q" });

    expect(sequenceHandler).toHaveBeenCalledTimes(1);
  });
});
