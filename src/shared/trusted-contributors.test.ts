import {
  isTrustedContributorSystemEnabled,
  TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY,
} from "@/shared/trusted-contributors";
import { describe, expect, it } from "vitest";

describe("trusted contributor preferences", () => {
  it('treats "false" as disabled', () => {
    expect(isTrustedContributorSystemEnabled("false")).toBe(false);
  });

  it("defaults to enabled for nullish or truthy values", () => {
    expect(isTrustedContributorSystemEnabled(null)).toBe(true);
    expect(isTrustedContributorSystemEnabled(undefined)).toBe(true);
    expect(isTrustedContributorSystemEnabled("true")).toBe(true);
  });

  it("exports the preference key", () => {
    expect(TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY).toBe("trustedContributorSystem");
  });
});
