/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";

// Mock the IPC layer for component tests
vi.mock("./renderer/lib/ipc", () => ({
  ipc: vi.fn(),
}));

// Mock window.api for Electron preload bridge
Object.defineProperty(globalThis, "api", {
  value: {
    invoke: vi.fn(),
    openExternal: vi.fn(),
    setBadgeCount: vi.fn(),
    onNavigate: vi.fn(() => () => {}),
  },
  writable: true,
});
