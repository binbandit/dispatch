import {
  categorizeHomePrs,
  filterHomePrSections,
  getDashboardPrKey,
  preferWorkspacePrs,
  type EnrichedDashboardPr,
} from "@/renderer/lib/inbox/home-prs";
import { describe, expect, it } from "vite-plus/test";

function createDashboardItem(
  overrides: Partial<EnrichedDashboardPr["pr"]> & {
    workspace?: string;
    workspacePath?: string;
  } = {},
): EnrichedDashboardPr {
  const workspace = overrides.workspace ?? "dispatch";
  const workspacePath = overrides.workspacePath ?? `/tmp/${workspace}`;

  return {
    pr: {
      number: overrides.number ?? 42,
      title: overrides.title ?? "Example pull request",
      state: overrides.state ?? "OPEN",
      author: overrides.author ?? { login: "brayden", name: "Brayden" },
      headRefName: overrides.headRefName ?? "feature/example",
      baseRefName: overrides.baseRefName ?? "main",
      reviewDecision: overrides.reviewDecision ?? "",
      updatedAt: overrides.updatedAt ?? "2026-03-31T00:00:00.000Z",
      url: overrides.url ?? "https://example.com/pr/42",
      isDraft: overrides.isDraft ?? false,
      additions: overrides.additions ?? 10,
      deletions: overrides.deletions ?? 4,
      workspace,
      workspacePath,
      repository: overrides.repository ?? `${workspace}-owner/${workspace}`,
      pullRequestRepository: overrides.pullRequestRepository ?? `${workspace}-owner/${workspace}`,
      isForkWorkspace: overrides.isForkWorkspace ?? false,
    },
    hasNewActivity: false,
  };
}

function getSection(items: ReturnType<typeof categorizeHomePrs>, id: string) {
  return items.find((section) => section.id === id);
}

describe("getDashboardPrKey", () => {
  it("keeps pull requests distinct across repositories", () => {
    expect(getDashboardPrKey("/tmp/dispatch", 42)).not.toBe(getDashboardPrKey("/tmp/api", 42));
  });
});

describe("categorizeHomePrs", () => {
  it("places review-requested pull requests into attention", () => {
    const sharedPr = createDashboardItem({
      number: 310,
      workspacePath: "/tmp/dispatch",
      workspace: "dispatch",
      reviewDecision: "REVIEW_REQUIRED",
    });

    const sections = categorizeHomePrs(
      [sharedPr],
      new Set([getDashboardPrKey(sharedPr.pr.pullRequestRepository, sharedPr.pr.number)]),
      "brayden",
    );

    expect(sections.map((section) => section.id)).toEqual([
      "attention",
      "reReview",
      "ship",
      "progress",
      "completed",
    ]);
    expect(getSection(sections, "attention")?.items).toHaveLength(1);
    expect(getSection(sections, "reReview")?.items).toHaveLength(0);
  });

  it("keeps different repositories with the same pull request number distinct", () => {
    const authoredPr = createDashboardItem({
      number: 123,
      workspacePath: "/tmp/dispatch",
      workspace: "dispatch",
    });
    const reviewPr = createDashboardItem({
      number: 123,
      workspacePath: "/tmp/api",
      workspace: "api",
      author: { login: "alex", name: "Alex" },
      reviewDecision: "REVIEW_REQUIRED",
    });

    const sections = categorizeHomePrs([authoredPr, reviewPr], new Set(), "brayden");

    expect(getSection(sections, "progress")?.items).toHaveLength(2);
  });

  it("keeps fork and upstream workspace entries separate when both are passed in", () => {
    const upstreamPr = createDashboardItem({
      number: 77,
      workspace: "dispatch-upstream",
      workspacePath: "/tmp/dispatch-upstream",
      repository: "acme/dispatch",
      pullRequestRepository: "acme/dispatch",
    });
    const forkPr = createDashboardItem({
      number: 77,
      workspace: "dispatch-fork",
      workspacePath: "/tmp/dispatch-fork",
      repository: "brayden/dispatch",
      pullRequestRepository: "acme/dispatch",
      isForkWorkspace: true,
    });

    const sections = categorizeHomePrs([upstreamPr, forkPr], new Set(), "brayden");

    expect(getSection(sections, "progress")?.items).toHaveLength(2);
  });

  it("puts completed pull requests into the completed section", () => {
    const mergedPr = createDashboardItem({
      number: 500,
      state: "MERGED",
    });

    const sections = categorizeHomePrs([mergedPr], new Set(), "brayden");

    expect(getSection(sections, "completed")?.items).toHaveLength(1);
  });

  it("keeps approved pull requests out of the ship section without merge permission", () => {
    const approvedPr = createDashboardItem({
      number: 777,
      reviewDecision: "APPROVED",
    });

    const sections = categorizeHomePrs([approvedPr], new Set(), "brayden", false);

    expect(getSection(sections, "ship")?.items).toHaveLength(0);
    expect(getSection(sections, "progress")?.items).toHaveLength(1);
  });

  it("moves seen review requests with new activity into re-review", () => {
    const reReviewPr = createDashboardItem({
      number: 101,
      workspacePath: "/tmp/dispatch",
      workspace: "dispatch",
      author: { login: "alex", name: "Alex" },
      reviewDecision: "REVIEW_REQUIRED",
    });
    const seenPr = {
      ...reReviewPr,
      hasNewActivity: true,
    };

    const sections = categorizeHomePrs(
      [seenPr],
      new Set([getDashboardPrKey(reReviewPr.pr.pullRequestRepository, reReviewPr.pr.number)]),
      "brayden",
    );

    expect(getSection(sections, "reReview")?.items).toHaveLength(1);
    expect(getSection(sections, "attention")?.items).toHaveLength(0);
  });

  it("keeps unseen review requests in attention", () => {
    const unseenPr = createDashboardItem({
      number: 102,
      workspacePath: "/tmp/dispatch",
      workspace: "dispatch",
      reviewDecision: "REVIEW_REQUIRED",
    });

    const sections = categorizeHomePrs(
      [unseenPr],
      new Set([getDashboardPrKey(unseenPr.pr.pullRequestRepository, unseenPr.pr.number)]),
      "brayden",
    );

    expect(getSection(sections, "attention")?.items).toHaveLength(1);
    expect(getSection(sections, "reReview")?.items).toHaveLength(0);
  });
}); 

describe("preferWorkspacePrs", () => {
  it("prefers the active workspace when fork and upstream workspaces point at the same pull request repo", () => {
    const upstreamPr = createDashboardItem({
      number: 77,
      workspacePath: "/tmp/upstream",
      repository: "acme/dispatch",
      pullRequestRepository: "acme/dispatch",
    });
    const forkPr = createDashboardItem({
      number: 77,
      workspacePath: "/tmp/fork",
      repository: "brayden/dispatch",
      pullRequestRepository: "acme/dispatch",
      isForkWorkspace: true,
    });

    const [preferred] = preferWorkspacePrs([upstreamPr, forkPr], "/tmp/fork");

    expect(preferred?.pr.workspacePath).toBe("/tmp/fork");
  });
});

describe("filterHomePrSections", () => {
  it("supports author shortcut queries like the dashboard placeholder suggests", () => {
    const authoredPr = createDashboardItem({
      number: 42,
      author: { login: "brayden", name: "Brayden Doyle" },
    });
    const reviewPr = createDashboardItem({
      number: 84,
      author: { login: "alex", name: "Alex Kim" },
      reviewDecision: "REVIEW_REQUIRED",
      title: "Fix CI flakes",
    });
    const sections = categorizeHomePrs(
      [authoredPr, reviewPr],
      new Set([getDashboardPrKey(reviewPr.pr.pullRequestRepository, reviewPr.pr.number)]),
      "brayden",
    );

    const filteredSections = filterHomePrSections(sections, "@brayden");

    expect(filteredSections).toHaveLength(1);
    expect(filteredSections[0]?.items.map((item) => item.pr.number)).toEqual([42]);
  });
});
