import { describe, expect, it } from "vitest";

import { resolveMergeStrategy } from "./merge-strategy";

describe("resolveMergeStrategy", () => {
  describe("type safety and input validation", () => {
    it("accepts all valid MergeStrategy types", () => {
      const strategies: Array<"merge" | "squash" | "rebase"> = ["merge", "squash", "rebase"];

      for (const strategy of strategies) {
        expect(() => {
          resolveMergeStrategy({
            hasMergeQueue: false,
            requirementsMet: true,
            canAdmin: false,
            strategy,
          });
        }).not.toThrow();
      }
    });

    it("handles all boolean combinations without errors", () => {
      const booleans = [true, false];

      for (const hasMergeQueue of booleans) {
        for (const requirementsMet of booleans) {
          for (const canAdmin of booleans) {
            expect(() => {
              resolveMergeStrategy({
                hasMergeQueue,
                requirementsMet,
                canAdmin,
                strategy: "squash",
              });
            }).not.toThrow();
          }
        }
      }
    });

    it("returns an object with required properties", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toHaveProperty("admin");
      expect(result).toHaveProperty("auto");
      expect(result).toHaveProperty("strategy");
    });

    it("admin is always either boolean true or undefined, never false", () => {
      const configs = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: false },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: false },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true },
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: true },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({ ...config, strategy: "squash" });
        expect(result.admin === true || result.admin === undefined).toBeTruthy();
      }
    });

    it("auto is always boolean, never undefined", () => {
      const configs = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: false },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({ ...config, strategy: "squash" });
        expectTypeOf(result.auto).toBeBoolean();
      }
    });

    it("strategy is always one of the three valid values", () => {
      const configs = [
        { hasMergeQueue: true, strategy: "merge" as const },
        { hasMergeQueue: true, strategy: "squash" as const },
        { hasMergeQueue: true, strategy: "rebase" as const },
        { hasMergeQueue: false, strategy: "merge" as const },
        { hasMergeQueue: false, strategy: "squash" as const },
        { hasMergeQueue: false, strategy: "rebase" as const },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          ...config,
          requirementsMet: true,
          canAdmin: false,
        });
        expect(["merge", "squash", "rebase"]).toContain(result.strategy);
      }
    });
  });

  describe("deterministic behavior", () => {
    it("returns same result for same inputs (idempotent)", () => {
      const input = {
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash" as const,
      };

      const result1 = resolveMergeStrategy(input);
      const result2 = resolveMergeStrategy(input);
      const result3 = resolveMergeStrategy(input);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it("order of boolean flags does not matter", () => {
      const result1 = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash",
      });

      const result2 = resolveMergeStrategy({
        canAdmin: true,
        strategy: "squash",
        hasMergeQueue: true,
        requirementsMet: false,
      } as any);

      expect(result1).toEqual(result2);
    });
  });

  describe("merge queue mode", () => {
    it("uses auto-merge when requirements are met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("uses auto-merge when requirements are NOT met (queues for later)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("uses admin override when explicitly requested via dropdown", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("forces squash strategy regardless of input", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "merge",
      });

      expect(result.strategy).toBe("squash");
    });

    it("NEVER auto-enables admin mode in merge queue", () => {
      // This is the critical bug we're preventing: even with admin privileges,
      // Clicking the main button should NOT bypass the queue
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: false, // Main button click
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeTruthy();
    });
  });

  describe("standard mode (no merge queue)", () => {
    it("immediate merge when requirements are met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "squash",
      });
    });

    it("uses admin override when requirements NOT met but user has admin", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("respects user's chosen strategy", () => {
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const strategy of strategies) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          requirementsMet: true,
          canAdmin: false,
          strategy,
        });

        expect(result.strategy).toBe(strategy);
      }
    });

    it("never uses auto-merge in standard mode", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: true,
        strategy: "squash",
      });

      expect(result.auto).toBeFalsy();
    });
  });

  describe("mutual exclusivity of admin and auto", () => {
    it("NEVER sets both admin and auto to true", () => {
      const scenarios = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: false, explicitAdmin: false },
      ];

      for (const scenario of scenarios) {
        const result = resolveMergeStrategy({
          ...scenario,
          strategy: "squash",
        });

        // Critical invariant: admin and auto must be mutually exclusive
        const bothTrue = result.admin === true && result.auto === true;
        expect(bothTrue).toBeFalsy();
      }
    });
  });

  describe("edge cases", () => {
    it("handles explicit admin override even when requirements are met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("ignores admin flag when user doesn't have admin privileges", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeFalsy();
    });

    it("handles explicit admin with no privileges (should still fail gracefully)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: false,
        explicitAdmin: true,
        strategy: "squash",
      });

      // Even though user requested admin, they don't have privileges
      expect(result.admin).toBeTruthy();
      expect(result.auto).toBeFalsy();
    });

    it("handles undefined explicitAdmin (same as false)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: undefined,
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeTruthy();
    });
  });

  describe("regression tests for production bug", () => {
    it("BUG SCENARIO: merge queue + admin + requirements not met + main button click", () => {
      // This was the exact scenario that caused the production issue:
      // User with admin privileges clicked "Merge when ready" button
      // On a PR with merge queue enabled but requirements not met.
      // Expected: Queue the PR for auto-merge when ready
      // Bug: Immediately merged using --admin, bypassing the queue
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: false, // Main button, NOT admin dropdown
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeTruthy();
      expect(result.strategy).toBe("squash");

      // Verify the bug is fixed: should NEVER have both flags
      expect(result.admin === true && result.auto === true).toBeFalsy();
    });

    it("BUG SCENARIO VARIANT: requirements met should still not use admin", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: true,
        explicitAdmin: false,
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeTruthy();
    });

    it("CORRECT SCENARIO: explicit admin dropdown should bypass queue", () => {
      // When user explicitly clicks "Merge now (admin)" from dropdown
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true, // Explicit admin override
        strategy: "squash",
      });

      expect(result.admin).toBeTruthy();
      expect(result.auto).toBeFalsy();
      expect(result.strategy).toBe("squash");
    });
  });

  describe("exhaustive combinatorial testing", () => {
    // Test all possible combinations of boolean flags
    const booleans = [true, false] as const;

    it("tests all 32 possible combinations", () => {
      const strategies = ["merge", "squash", "rebase"] as const;
      let testedCount = 0;

      for (const hasMergeQueue of booleans) {
        for (const requirementsMet of booleans) {
          for (const canAdmin of booleans) {
            for (const explicitAdmin of booleans) {
              for (const strategy of strategies) {
                const result = resolveMergeStrategy({
                  hasMergeQueue,
                  requirementsMet,
                  canAdmin,
                  explicitAdmin,
                  strategy,
                });

                // Core invariant: admin and auto are mutually exclusive
                expect(result.admin === true && result.auto === true).toBeFalsy();

                // Merge queue always forces squash
                if (hasMergeQueue) {
                  expect(result.strategy).toBe("squash");
                } else {
                  expect(result.strategy).toBe(strategy);
                }

                // Auto only when merge queue AND not using admin
                const useAdmin = explicitAdmin || (!hasMergeQueue && !requirementsMet && canAdmin);
                if (hasMergeQueue && !useAdmin) {
                  expect(result.auto).toBeTruthy();
                } else {
                  expect(result.auto).toBeFalsy();
                }

                testedCount++;
              }
            }
          }
        }
      }

      // 2 hasMergeQueue × 2 requirementsMet × 2 canAdmin × 2 explicitAdmin × 3 strategies = 48
      expect(testedCount).toBe(48);
    });
  });

  describe("merge queue mode - comprehensive", () => {
    it("regular user, requirements met, main button", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("regular user, requirements not met, main button", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: false,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("admin user, requirements met, main button", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("admin user, requirements not met, main button (CRITICAL BUG TEST)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("admin user, requirements met, admin dropdown", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("admin user, requirements not met, admin dropdown", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("regular user cannot use admin dropdown (but function still works)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: false,
        explicitAdmin: true,
        strategy: "merge",
      });

      // Function doesn't validate permissions, just sets the flag
      // UI should prevent this, but function handles it gracefully
      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("all three strategies normalize to squash in merge queue", () => {
      for (const strategy of ["merge", "squash", "rebase"] as const) {
        const result = resolveMergeStrategy({
          hasMergeQueue: true,
          requirementsMet: true,
          canAdmin: false,
          strategy,
        });

        expect(result.strategy).toBe("squash");
      }
    });
  });

  describe("standard mode - comprehensive", () => {
    it("regular user, requirements met, main button", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: false,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "merge",
      });
    });

    it("regular user, requirements not met, cannot merge", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "merge",
      });
    });

    it("admin user, requirements met, main button", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "merge",
      });
    });

    it("admin user, requirements not met, main button auto-enables admin", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "merge",
      });
    });

    it("admin user, requirements met, explicit admin", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "merge",
      });
    });

    it("admin user, requirements not met, explicit admin", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "merge",
      });
    });

    it("respects all three strategies independently", () => {
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const strategy of strategies) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          requirementsMet: true,
          canAdmin: false,
          strategy,
        });

        expect(result.strategy).toBe(strategy);
      }
    });

    it("never uses auto-merge regardless of configuration", () => {
      const configs = [
        { requirementsMet: true, canAdmin: false, explicitAdmin: false },
        { requirementsMet: false, canAdmin: false, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: true },
        { requirementsMet: false, canAdmin: true, explicitAdmin: true },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          ...config,
          strategy: "squash",
        });

        expect(result.auto).toBeFalsy();
      }
    });
  });

  describe("property-based invariants", () => {
    it("admin is never true when canAdmin is false and explicitAdmin is false", () => {
      const configs = [
        { hasMergeQueue: true, requirementsMet: true },
        { hasMergeQueue: true, requirementsMet: false },
        { hasMergeQueue: false, requirementsMet: true },
        { hasMergeQueue: false, requirementsMet: false },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          ...config,
          canAdmin: false,
          explicitAdmin: false,
          strategy: "squash",
        });

        expect(result.admin).toBeUndefined();
      }
    });

    it("auto is always false when hasMergeQueue is false", () => {
      const configs = [
        { requirementsMet: true, canAdmin: false, explicitAdmin: false },
        { requirementsMet: false, canAdmin: false, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: true },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          ...config,
          strategy: "squash",
        });

        expect(result.auto).toBeFalsy();
      }
    });

    it("strategy is always squash when hasMergeQueue is true", () => {
      const configs = [
        { requirementsMet: true, canAdmin: false, explicitAdmin: false },
        { requirementsMet: false, canAdmin: false, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { requirementsMet: true, canAdmin: true, explicitAdmin: true },
      ];
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const config of configs) {
        for (const strategy of strategies) {
          const result = resolveMergeStrategy({
            hasMergeQueue: true,
            ...config,
            strategy,
          });

          expect(result.strategy).toBe("squash");
        }
      }
    });

    it("explicitAdmin=true always sets admin=true", () => {
      const configs = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: true },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true },
        { hasMergeQueue: true, requirementsMet: true, canAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: false },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          ...config,
          explicitAdmin: true,
          strategy: "squash",
        });

        expect(result.admin).toBeTruthy();
      }
    });

    it("admin=true always sets auto=false", () => {
      const configs = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true, explicitAdmin: true },
      ];

      for (const config of configs) {
        const result = resolveMergeStrategy({
          ...config,
          strategy: "squash",
        });

        if (result.admin === true) {
          expect(result.auto).toBeFalsy();
        }
      }
    });
  });

  describe("CLI command flag validation", () => {
    it("produces valid gh pr merge command flags", () => {
      const testCases = [
        {
          input: {
            hasMergeQueue: true,
            requirementsMet: true,
            canAdmin: false,
            strategy: "squash" as const,
          },
          expectedFlags: ["--squash", "--auto"],
        },
        {
          input: {
            hasMergeQueue: true,
            requirementsMet: false,
            canAdmin: true,
            explicitAdmin: true,
            strategy: "squash" as const,
          },
          expectedFlags: ["--squash", "--admin"],
        },
        {
          input: {
            hasMergeQueue: false,
            requirementsMet: true,
            canAdmin: false,
            strategy: "merge" as const,
          },
          expectedFlags: ["--merge"],
        },
        {
          input: {
            hasMergeQueue: false,
            requirementsMet: false,
            canAdmin: true,
            strategy: "rebase" as const,
          },
          expectedFlags: ["--rebase", "--admin"],
        },
      ];

      for (const { input, expectedFlags } of testCases) {
        const result = resolveMergeStrategy(input);
        const actualFlags: string[] = [`--${result.strategy}`];
        if (result.admin) {
          actualFlags.push("--admin");
        }
        if (result.auto) {
          actualFlags.push("--auto");
        }

        expect(actualFlags.toSorted()).toEqual(expectedFlags.toSorted());
      }
    });

    it("never produces both --admin and --auto flags", () => {
      const allConfigs = [
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: true, requirementsMet: true, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: true, requirementsMet: false, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true, explicitAdmin: false },
        { hasMergeQueue: false, requirementsMet: true, canAdmin: true, explicitAdmin: true },
        { hasMergeQueue: false, requirementsMet: false, canAdmin: true, explicitAdmin: true },
      ];

      for (const config of allConfigs) {
        const result = resolveMergeStrategy({ ...config, strategy: "squash" });
        const hasAdmin = result.admin === true;
        const hasAuto = result.auto === true;

        // The production bug: both flags present
        expect(hasAdmin && hasAuto).toBeFalsy();
      }
    });
  });

  describe("github merge queue behavior", () => {
    it("queues PR when requirements not met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: false,
        strategy: "squash",
      });

      // Should use auto-merge to queue it
      expect(result.auto).toBeTruthy();
      expect(result.admin).toBeUndefined();
    });

    it("queues PR when requirements met (will merge immediately)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      // Still uses auto-merge (GitHub will process it immediately)
      expect(result.auto).toBeTruthy();
      expect(result.admin).toBeUndefined();
    });

    it("admin can bypass queue with explicit flag", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "squash",
      });

      // Bypasses queue entirely
      expect(result.admin).toBeTruthy();
      expect(result.auto).toBeFalsy();
    });

    it("admin main button does NOT bypass queue", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: false,
        strategy: "squash",
      });

      // Still queues it
      expect(result.auto).toBeTruthy();
      expect(result.admin).toBeUndefined();
    });
  });

  describe("standard merge behavior (no queue)", () => {
    it("merges immediately when requirements met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result.auto).toBeFalsy();
      expect(result.admin).toBeUndefined();
    });

    it("admin can force merge when requirements not met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash",
      });

      expect(result.admin).toBeTruthy();
      expect(result.auto).toBeFalsy();
    });

    it("regular user cannot merge when requirements not met", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
      expect(result.auto).toBeFalsy();
      // UI should disable the button in this case
    });
  });

  describe("strategy selection", () => {
    it("merge queue overrides all strategies to squash", () => {
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const strategy of strategies) {
        const result = resolveMergeStrategy({
          hasMergeQueue: true,
          requirementsMet: true,
          canAdmin: false,
          strategy,
        });

        expect(result.strategy).toBe("squash");
      }
    });

    it("standard mode preserves user choice", () => {
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const strategy of strategies) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          requirementsMet: true,
          canAdmin: false,
          strategy,
        });

        expect(result.strategy).toBe(strategy);
      }
    });

    it("admin override preserves strategy in standard mode", () => {
      const strategies = ["merge", "squash", "rebase"] as const;

      for (const strategy of strategies) {
        const result = resolveMergeStrategy({
          hasMergeQueue: false,
          requirementsMet: false,
          canAdmin: true,
          strategy,
        });

        expect(result.strategy).toBe(strategy);
        expect(result.admin).toBeTruthy();
      }
    });
  });

  describe("permission boundary tests", () => {
    it("canAdmin=false prevents auto-admin in standard mode", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result.admin).toBeUndefined();
    });

    it("canAdmin=true enables auto-admin in standard mode", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash",
      });

      expect(result.admin).toBeTruthy();
    });

    it("canAdmin=false with explicitAdmin=true still sets admin flag", () => {
      // Function doesn't validate permissions, UI should
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        explicitAdmin: true,
        strategy: "squash",
      });

      expect(result.admin).toBeTruthy();
    });
  });

  describe("real-world scenarios", () => {
    it("scenario: Junior dev on PR with passing checks (no queue)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "squash",
      });
    });

    it("scenario: Junior dev on PR with failing checks (no queue)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "squash",
      });
      // Button should be disabled
    });

    it("scenario: Maintainer on PR with passing checks (with queue)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: true,
        strategy: "merge", // Will be overridden
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("scenario: Maintainer needs to hotfix bypass queue", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "squash",
      });
    });

    it("scenario: Dependabot PR with all checks passing (with queue)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: true,
        requirementsMet: true,
        canAdmin: false,
        strategy: "squash",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: true,
        strategy: "squash",
      });
    });

    it("scenario: Emergency production fix by admin (no queue)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: false,
        canAdmin: true,
        strategy: "merge",
      });

      expect(result).toEqual({
        admin: true,
        auto: false,
        strategy: "merge",
      });
    });

    it("scenario: Regular merge after CI passes (no queue, rebase workflow)", () => {
      const result = resolveMergeStrategy({
        hasMergeQueue: false,
        requirementsMet: true,
        canAdmin: false,
        strategy: "rebase",
      });

      expect(result).toEqual({
        admin: undefined,
        auto: false,
        strategy: "rebase",
      });
    });
  });

  describe("state transition tests", () => {
    it("changing from no queue to queue mode changes behavior", () => {
      const baseConfig = {
        requirementsMet: true,
        canAdmin: true,
        strategy: "merge" as const,
      };

      const noQueue = resolveMergeStrategy({
        ...baseConfig,
        hasMergeQueue: false,
      });

      const withQueue = resolveMergeStrategy({
        ...baseConfig,
        hasMergeQueue: true,
      });

      expect(noQueue.auto).toBeFalsy();
      expect(noQueue.strategy).toBe("merge");

      expect(withQueue.auto).toBeTruthy();
      expect(withQueue.strategy).toBe("squash");
    });

    it("requirements changing from met to not met affects admin", () => {
      const baseConfig = {
        hasMergeQueue: false,
        canAdmin: true,
        strategy: "squash" as const,
      };

      const requirementsMet = resolveMergeStrategy({
        ...baseConfig,
        requirementsMet: true,
      });

      const requirementsNotMet = resolveMergeStrategy({
        ...baseConfig,
        requirementsMet: false,
      });

      expect(requirementsMet.admin).toBeUndefined();
      expect(requirementsNotMet.admin).toBeTruthy();
    });

    it("gaining admin privileges changes behavior", () => {
      const baseConfig = {
        hasMergeQueue: false,
        requirementsMet: false,
        strategy: "squash" as const,
      };

      const noAdmin = resolveMergeStrategy({
        ...baseConfig,
        canAdmin: false,
      });

      const withAdmin = resolveMergeStrategy({
        ...baseConfig,
        canAdmin: true,
      });

      expect(noAdmin.admin).toBeUndefined();
      expect(withAdmin.admin).toBeTruthy();
    });
  });

  describe("consistency tests", () => {
    it("same inputs always produce same output (pure function)", () => {
      const input = {
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        explicitAdmin: false,
        strategy: "squash" as const,
      };

      const results = Array.from({ length: 100 }, () => resolveMergeStrategy(input));

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toEqual(results[0]);
      }
    });

    it("no side effects - function is pure", () => {
      const input = {
        hasMergeQueue: true,
        requirementsMet: false,
        canAdmin: true,
        strategy: "squash" as const,
      };

      const inputCopy = { ...input };

      resolveMergeStrategy(input);

      expect(input).toEqual(inputCopy);
    });
  });
});
