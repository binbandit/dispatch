import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

import { AppLayout } from "@/renderer/components/shell/app-layout";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  dismissPathMissingMock,
  goBackMock,
  goForwardMock,
  navigateMock,
  onNavigateMock,
  onWindowStateChangeMock,
  resetFileNavMock,
  resetRouterMock,
  toggleSettingsMock,
  mockRoute,
} = vi.hoisted(() => ({
  dismissPathMissingMock: vi.fn(),
  goBackMock: vi.fn(),
  goForwardMock: vi.fn(),
  navigateMock: vi.fn(),
  onNavigateMock: vi.fn(() => vi.fn()),
  onWindowStateChangeMock: vi.fn(() => vi.fn()),
  resetFileNavMock: vi.fn(),
  resetRouterMock: vi.fn(),
  toggleSettingsMock: vi.fn(),
  mockRoute: { view: "review" as const, prNumber: 123 as number | null },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: true }),
}));

vi.mock("@/renderer/components/inbox/command-palette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/renderer/components/inbox/home-view", () => ({
  HomeView: () => <div>Home View</div>,
}));

vi.mock("@/renderer/components/inbox/merge-queue-view", () => ({
  MergeQueueView: () => <div>Merge Queue</div>,
}));

vi.mock("@/renderer/components/inbox/metrics-view", () => ({
  MetricsView: () => <div>Metrics</div>,
}));

vi.mock("@/renderer/components/review/pr-detail-view", () => ({
  PrDetailView: () => <div>PR Detail</div>,
}));

vi.mock("@/renderer/components/review/sidebar/review-sidebar", () => ({
  ReviewSidebar: () => <div>Review Sidebar</div>,
}));

vi.mock("@/renderer/components/settings/settings-view", () => ({
  SettingsView: () => <div>Settings</div>,
}));

vi.mock("@/renderer/components/shared/missing-folder-dialog", () => ({
  MissingFolderDialog: () => null,
}));

vi.mock("@/renderer/components/workflows/releases-view", () => ({
  ReleasesView: () => <div>Releases</div>,
}));

vi.mock("@/renderer/components/workflows/workflows-dashboard", () => ({
  WorkflowsDashboard: () => <div>Workflows</div>,
}));

vi.mock("@/renderer/hooks/app/use-notification-polling", () => ({
  useNotificationPolling: () => null,
}));

vi.mock("@/renderer/hooks/app/use-workspace-path-monitor", () => ({
  useWorkspacePathMonitor: () => ({
    pathMissing: false,
    dismiss: dismissPathMissingMock,
  }),
}));

vi.mock("@/renderer/lib/app/posthog", () => ({
  listenForMainProcessEvents: vi.fn(),
}));

vi.mock("@/renderer/lib/app/router", () => ({
  useRouter: () => ({
    route: mockRoute,
    navigate: navigateMock,
    goBack: goBackMock,
    goForward: goForwardMock,
    toggleSettings: toggleSettingsMock,
  }),
  useRouterStore: {
    getState: () => ({
      reset: resetRouterMock,
    }),
  },
}));

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    nwo: "acme/dispatch",
  }),
}));

vi.mock("@/renderer/lib/keyboard/keybinding-context", () => ({
  useKeybindings: () => ({
    getBinding: (id: string) => {
      switch (id) {
        case "views.review": {
          return { key: "1" };
        }
        default: {
          return { key: "" };
        }
      }
    },
  }),
}));

vi.mock("@/renderer/lib/review/file-nav-context", () => ({
  useFileNavStore: {
    getState: () => ({
      reset: resetFileNavMock,
      getSnapshot: () => ({
        currentFilePath: null,
        currentFileIndex: 0,
        diffMode: "split",
        panelOpen: false,
        panelTab: "overview",
        selectedCommit: null,
      }),
    }),
    subscribe: () => () => {},
  },
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => null,
  ResizablePanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/renderer/components/shell/keyboard-shortcuts-dialog", () => ({
  KeyboardShortcutsDialog: () => null,
}));

vi.mock("@/renderer/components/shell/navbar", () => ({
  Navbar: () => <div>Navbar</div>,
}));

vi.mock("@/renderer/components/shell/update-banner", () => ({
  UpdateBanner: () => null,
}));

describe("AppLayout keyboard shortcuts", () => {
  beforeEach(() => {
    dismissPathMissingMock.mockReset();
    goBackMock.mockReset();
    goForwardMock.mockReset();
    navigateMock.mockReset();
    onNavigateMock.mockClear();
    onWindowStateChangeMock.mockClear();
    resetFileNavMock.mockReset();
    resetRouterMock.mockReset();
    toggleSettingsMock.mockReset();
    mockRoute.view = "review";
    mockRoute.prNumber = 123;

    (globalThis as Record<string, unknown>).api = {
      onNavigate: onNavigateMock,
      onWindowStateChange: onWindowStateChangeMock,
    };
  });

  it("returns to the home queue when g then q is pressed on a selected PR", () => {
    render(<AppLayout />);

    fireEvent.keyDown(globalThis.window, { key: "g" });
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.keyDown(globalThis.window, { key: "q" });

    expect(navigateMock).toHaveBeenCalledWith({ view: "review", prNumber: null });
  });

  it("ignores the queue sequence when already on the home queue", () => {
    mockRoute.prNumber = null;

    render(<AppLayout />);

    fireEvent.keyDown(globalThis.window, { key: "g" });
    fireEvent.keyDown(globalThis.window, { key: "q" });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
