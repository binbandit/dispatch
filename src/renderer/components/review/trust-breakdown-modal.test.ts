import type { GhUserProfile } from "@/shared/ipc";

import { computeTrustBreakdown } from "@/renderer/components/review/trust-breakdown-modal";
import { describe, expect, it } from "vite-plus/test";

const baseProfile: GhUserProfile = {
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://example.com/octocat.png",
  bio: null,
  company: null,
  location: null,
  followers: 10,
  following: 2,
  publicRepos: 8,
  createdAt: "2024-01-01T00:00:00Z",
  organizations: [],
  repoContributions: null,
};

describe("computeTrustBreakdown", () => {
  it("credits prior repository contributions in the trust score", () => {
    const withoutHistory = computeTrustBreakdown(baseProfile);
    const withHistory = computeTrustBreakdown({
      ...baseProfile,
      repoContributions: {
        repo: "octo/dispatch",
        pullRequests: 4,
        mergedPullRequests: 2,
        issues: 1,
        reviewedPullRequests: 3,
        total: 8,
      },
    });

    expect(withHistory.repoHistory).toBeGreaterThan(0);
    expect(withHistory.total).toBeGreaterThan(withoutHistory.total);
  });
});
