import type { GhUserProfile } from "@/shared/ipc";

import { AuthorDossier } from "@/renderer/components/review/author-dossier";
import "@testing-library/jest-dom/vitest";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { ipc } from "@/renderer/lib/app/ipc";
import { TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY } from "@/shared/trusted-contributors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("@/renderer/lib/app/ipc"), () => ({
  ipc: vi.fn(),
}));

vi.mock(import("@/renderer/hooks/preferences/use-preference"), async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/renderer/hooks/preferences/use-preference",
  );

  return {
    ...actual,
    usePreference: vi.fn(),
  };
});

vi.mock(import("@/renderer/components/shared/github-avatar"), () => ({
  GitHubAvatar: ({ login }: { login: string }) => <div>{login}</div>,
}));

vi.mock(import("@/renderer/components/review/trust-breakdown-modal"), async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/renderer/components/review/trust-breakdown-modal",
  );

  return {
    ...actual,
    TrustBreakdownModal: () => <div />,
  };
});

const BASE_PROFILE: GhUserProfile = {
  login: "alice",
  name: "Alice Example",
  avatarUrl: "https://example.com/alice.png",
  bio: "Builds dependable review tooling.",
  company: "@Dispatch",
  location: "Melbourne",
  followers: 240,
  following: 10,
  publicRepos: 64,
  createdAt: "2014-04-01T00:00:00Z",
  organizations: [
    { login: "dispatch", avatarUrl: "https://example.com/dispatch.png" },
    { login: "open-source", avatarUrl: "https://example.com/open-source.png" },
    { login: "standards", avatarUrl: "https://example.com/standards.png" },
  ],
  repoContributions: {
    repo: "acme/dispatch",
    pullRequests: 8,
    mergedPullRequests: 6,
    issues: 4,
    reviewedPullRequests: 5,
    total: 23,
  },
};

function renderAuthorDossier(preferenceValue: string | null = null) {
  vi.mocked(usePreference).mockImplementation((key: string) =>
    key === TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY ? preferenceValue : null,
  );
  vi.mocked(ipc).mockImplementation((method: string) => {
    if (method === "env.userProfile") {
      return Promise.resolve(BASE_PROFILE);
    }

    return Promise.resolve(null);
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthorDossier
        login="alice"
        author={{ login: "alice", name: "Alice Example" }}
        createdAt="2026-04-01T00:00:00Z"
        repo="acme/dispatch"
        prNumber={42}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthorDossier", () => {
  it("shows the trust badge when the trusted contributor system is enabled", async () => {
    renderAuthorDossier();

    expect(await screen.findByRole("button", { name: "Trusted" })).toBeInTheDocument();
  });

  it("hides the trust badge when the trusted contributor system is disabled", async () => {
    renderAuthorDossier("false");

    expect(await screen.findByText("Builds dependable review tooling.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trusted" })).not.toBeInTheDocument();
  });
});
