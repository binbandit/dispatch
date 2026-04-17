import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

import {
  ReleasesView,
  RELEASES_QUERY_CACHE_MS,
} from "@/renderer/components/workflows/releases-view";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const useQueryMock = vi.fn((options: { queryKey: string[] }) => {
  if (options.queryKey[0] === "releases") {
    return { data: [], isLoading: false };
  }

  return { data: { canPush: false }, isLoading: false };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useQuery: (options: { queryKey: string[] }) => useQueryMock(options),
}));

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    nwo: "acme/dispatch",
    repoTarget: {
      cwd: "/tmp/dispatch",
      owner: "acme",
      repo: "dispatch",
    },
  }),
}));

vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

vi.mock("@/renderer/lib/app/query-client", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <div>Loading</div>,
}));

vi.mock("@/components/ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

vi.mock("@/renderer/components/shared/github-avatar", () => ({
  GitHubAvatar: () => null,
}));

vi.mock("@/renderer/components/shared/markdown-body", () => ({
  MarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe("ReleasesView", () => {
  it("keeps the releases query cached for longer-lived cache-first navigation", () => {
    render(<ReleasesView />);

    expect(screen.getByText("Releases")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledTimes(2);
    expect(useQueryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        gcTime: RELEASES_QUERY_CACHE_MS,
        queryKey: ["releases", "list", "acme/dispatch"],
        staleTime: RELEASES_QUERY_CACHE_MS,
      }),
    );
  });
});
