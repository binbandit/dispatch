export const EXPERIMENTAL_FEATURES = [
  {
    key: "experimentalOledTheme",
    label: "OLED theme",
    description:
      "Try a deeper black theme tuned for OLED displays before it becomes a standard appearance option.",
  },
  {
    key: "experimentalSemanticDiff",
    label: "Semantic diff summary",
    description:
      "Detect pure renames, whitespace-only edits, and identifier renames, and surface them as a one-line summary above the diff so you can skim past noise.",
  },
] as const;

export type ExperimentalFeatureKey = (typeof EXPERIMENTAL_FEATURES)[number]["key"];

export const EXPERIMENTAL_FEATURE_PREFERENCE_KEYS = EXPERIMENTAL_FEATURES.map(
  (feature) => feature.key,
);

export function isExperimentalFeatureEnabled(value: string | null | undefined): boolean {
  return value === "true";
}
