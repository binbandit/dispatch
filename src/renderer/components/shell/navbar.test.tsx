import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

import { Navbar } from "@/renderer/components/shell/navbar";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockRoute, navigateMock } = vi.hoisted(() => ({
  mockRoute: { view: "review" as "review" | "metrics", prNumber: null as number | null },
  navigateMock: vi.fn(),
}));

let collapseChromeLabels = false;
let collapseNavLabels = true;

vi.mock(import("@/renderer/lib/app/ipc"), () => ({
  ipc: vi.fn(),
}));

vi.mock("@/components/ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => <>{children}</>,
  MenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuGroupLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  MenuPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuSeparator: () => null,
  MenuTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button
      type="button"
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipPopup: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>{render ?? children}</>
  ),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: ({ max }: { max: number }) =>
    max === 1100 ? collapseNavLabels : collapseChromeLabels,
}));

vi.mock("@/renderer/components/shared/add-repo-dialog", () => ({
  AddRepoDialog: () => null,
}));

vi.mock("@/renderer/components/shared/dispatch-logo", () => ({
  DispatchLogo: () => <span>logo</span>,
}));

vi.mock("@/renderer/components/shell/notification-center", () => ({
  NotificationCenter: () => <div>Notifications</div>,
}));

vi.mock("@/renderer/lib/app/open-external", () => ({
  openExternal: vi.fn(),
}));

vi.mock("@/renderer/lib/app/router", () => ({
  useRouter: () => ({
    route: mockRoute,
    navigate: navigateMock,
    toggleSettings: vi.fn(),
  }),
}));

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    nwo: "binbandit/dispatch",
    repo: "dispatch",
    repoTarget: { cwd: "/repos/dispatch", owner: "binbandit", repo: "dispatch" },
    switchWorkspace: vi.fn(),
  }),
}));

function renderNavbar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Navbar
        bannerVisible={false}
        isFullscreen={false}
      />
    </QueryClientProvider>,
  );
}

function mockNavbarIpc(args?: {
  topBarLabelMode?: string | null;
  topBarVisibleTabs?: string | null;
}) {
  const topBarLabelMode = args?.topBarLabelMode ?? null;
  const topBarVisibleTabs = args?.topBarVisibleTabs ?? null;

  vi.mocked(ipc).mockImplementation((method, params) => {
    const preferenceKey = (params as { key?: string } | undefined)?.key;

    switch (method) {
      case "preferences.get": {
        if (preferenceKey === "topBarLabelMode") {
          return Promise.resolve(topBarLabelMode);
        }
        if (preferenceKey === "topBarVisibleTabs") {
          return Promise.resolve(topBarVisibleTabs);
        }
        return Promise.resolve(null);
      }
      case "repo.info": {
        return Promise.resolve({
          nameWithOwner: "binbandit/dispatch",
          isFork: false,
          parent: null,
          canPush: true,
          hasMergeQueue: false,
          defaultBranch: "main",
        });
      }
      case "env.user": {
        return Promise.resolve({
          login: "brayden",
          avatarUrl: "https://example.com/avatar.png",
          name: "Brayden",
        });
      }
      case "env.accounts": {
        return Promise.resolve([
          {
            login: "brayden",
            host: "github.com",
            active: true,
            scopes: "repo",
            gitProtocol: "https",
          },
        ]);
      }
      default: {
        throw new Error(`Unexpected IPC method: ${String(method)}`);
      }
    }
  });
}

describe("Navbar", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    mockRoute.view = "review";
    mockRoute.prNumber = null;
    collapseChromeLabels = false;
    collapseNavLabels = true;
    mockNavbarIpc();
  });

  it("keeps the compact review tab clickable when labels collapse", () => {
    renderNavbar();

    const reviewButton = screen.getByRole("button", { name: "Review" });

    fireEvent.click(reviewButton);

    expect(navigateMock).toHaveBeenCalledWith({ view: "review", prNumber: null });
  });

  it("hides optional tabs when the user disables them in settings", async () => {
    mockNavbarIpc({ topBarVisibleTabs: "[]" });

    renderNavbar();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Metrics" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Releases" })).not.toBeInTheDocument();
    });
  });

  it("keeps a hidden tab visible while that route is active", async () => {
    mockRoute.view = "metrics";
    mockNavbarIpc({ topBarVisibleTabs: "[]" });

    renderNavbar();

    expect(await screen.findByRole("button", { name: "Metrics" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Releases" })).not.toBeInTheDocument();
    });
  });

  it("renders icon-only tabs when the user prefers that mode", async () => {
    collapseNavLabels = false;
    mockNavbarIpc({ topBarLabelMode: "icon-only" });

    renderNavbar();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review" }).textContent).toBe("");
    });
  });

  it("keeps text labels when the user prefers icons with text and space allows it", async () => {
    collapseNavLabels = false;
    mockNavbarIpc({ topBarLabelMode: "icon-and-text" });

    renderNavbar();

    const reviewButton = await screen.findByRole("button", { name: "Review" });

    expect(reviewButton).toHaveTextContent("Review");
  });
});
