import { usePreference } from "./use-preference";

export type NameFormat = "login" | "name";

/**
 * Returns the user's preferred name display format.
 * Defaults to "name" (real names with login fallback).
 */
export function useDisplayNameFormat(): NameFormat {
  const pref = usePreference("displayNameFormat");
  return pref === "login" ? "login" : "name";
}

/**
 * Resolve an author's display name based on the user's format preference.
 * When format is "name", returns real name with login fallback.
 * When format is "login", always returns login.
 */
export function formatAuthorName(
  author: { login: string; name?: string | null },
  format: NameFormat,
): string {
  if (format === "name" && author.name) {
    return author.name;
  }
  return author.login;
}
