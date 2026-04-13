/**
 * Normalise an unknown value to a trimmed non-empty string or null.
 * Used across AI provider config, model resolution, and preference reading.
 */
export function normalizeValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
