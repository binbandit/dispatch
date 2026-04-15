export interface PrSearchPreset {
  id: string;
  label: string;
  query: string;
  hint: string;
  preferredFilter?: "all" | "mine" | "reReview" | "review";
  surfaces: Array<"home" | "sidebar">;
}

const SEARCH_PRESETS: PrSearchPreset[] = [
  {
    id: "needs-review",
    label: "Needs review",
    query: "(review:review OR review:changes) state:open",
    hint: "Review requests and requested changes",
    preferredFilter: "review",
    surfaces: ["home", "sidebar"],
  },
  {
    id: "my-prs",
    label: "My Pull Requests",
    query: "is:mine state:open",
    hint: "Your open pull requests",
    preferredFilter: "mine",
    surfaces: ["home"],
  },
  {
    id: "my-drafts",
    label: "My drafts",
    query: "is:mine is:draft",
    hint: "Your draft pull requests",
    preferredFilter: "mine",
    surfaces: ["home", "sidebar"],
  },
  {
    id: "recently-merged",
    label: "Recently merged",
    query: "state:merged updated:7d",
    hint: "Merged in the last week",
    preferredFilter: "all",
    surfaces: ["sidebar"],
  },
  {
    id: "current-repo",
    label: "Current repo",
    query: "repo:current is:active",
    hint: "Recently active pull requests in the active repo",
    preferredFilter: "all",
    surfaces: ["home", "sidebar"],
  },
];

export function getPrSearchPresets(surface: "home" | "sidebar"): PrSearchPreset[] {
  return SEARCH_PRESETS.filter((preset) => preset.surfaces.includes(surface));
}
