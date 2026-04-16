export const TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY = "trustedContributorSystem";

export function isTrustedContributorSystemEnabled(value?: string | null): boolean {
  return value !== "false";
}
