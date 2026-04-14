export const EXPERIMENTAL_FEATURES = [
  {
    key: "experimentalOledTheme",
    label: "OLED theme",
    description:
      "Try a deeper black theme tuned for OLED displays before it becomes a standard appearance option.",
  },
  {
    key: "experimentalCommandPaletteOmnibar",
    label: "Command palette omnibar",
    description:
      "Try a denser palette mode that blends navigation, search, and quick actions into one surface.",
  },
  {
    key: "experimentalReviewSignals",
    label: "Review signals overlay",
    description:
      "Surface early heuristics and queue hints directly in review flows while we refine the signal quality.",
  },
  {
    key: "experimentalWorkflowGraph",
    label: "Workflow graph preview",
    description:
      "Preview workflow runs with a graph-first layout before it becomes part of the main workflows experience.",
  },
] as const;

export type ExperimentalFeatureKey = (typeof EXPERIMENTAL_FEATURES)[number]["key"];

export const EXPERIMENTAL_FEATURE_PREFERENCE_KEYS = EXPERIMENTAL_FEATURES.map(
  (feature) => feature.key,
);

export function isExperimentalFeatureEnabled(value: string | null | undefined): boolean {
  return value === "true";
}
