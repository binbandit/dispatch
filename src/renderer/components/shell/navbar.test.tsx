import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

import { Navbar } from "@/renderer/components/shell/navbar";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

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
  useMediaQuery: ({ max }: { max: number }) => max === 1100,
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
    route: { view: "review" as const, prNumber: null as number | null },
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

describe("Navbar", () => {
  it("keeps the compact review tab clickable when labels collapse", () => {
    vi.mocked(ipc).mockImplementation((method) => {
      switch (method) {
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

    renderNavbar();

    const reviewButton = screen.getByRole("button", { name: "Review" });

    fireEvent.click(reviewButton);

    expect(navigateMock).toHaveBeenCalledWith({ view: "review", prNumber: null });
  });
});
