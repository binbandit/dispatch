export const TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY = "trustedContributorSystem";

export function isTrustedContributorSystemEnabled(value: string | null | undefined): boolean {
  return value !== "false";
}
