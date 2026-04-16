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

  it("fires symbol-key shortcuts like ? even though shift is required to type them", () => {
    const handler = vi.fn();

    render(<ShortcutHarness shortcuts={[{ key: "?", handler }]} />);

    fireEvent.keyDown(globalThis.window, { key: "?", shiftKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still differentiates letter shortcuts by shift modifier", () => {
    const plain = vi.fn();
    const shifted = vi.fn();

    render(
      <ShortcutHarness
        shortcuts={[
          { key: "c", handler: plain },
          { key: "c", modifiers: ["shift"], handler: shifted },
        ]}
      />,
    );

    fireEvent.keyDown(globalThis.window, { key: "C", shiftKey: true });

    expect(plain).not.toHaveBeenCalled();
    expect(shifted).toHaveBeenCalledTimes(1);
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
