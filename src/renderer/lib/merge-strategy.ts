/**
 * Merge strategy resolution logic
 *
 * Determines the correct flags for `gh pr merge` based on:
 * - Merge queue presence
 * - Requirements met status
 * - Admin privileges
 * - Explicit admin override
 *
 * Key invariant: `admin` and `auto` are mutually exclusive.
 */

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface MergeStrategyInput {
  hasMergeQueue: boolean;
  requirementsMet: boolean;
  canAdmin: boolean;
  explicitAdmin?: boolean;
  strategy: MergeStrategy;
}

export interface MergeStrategyOutput {
  admin: boolean | undefined;
  auto: boolean;
  strategy: MergeStrategy;
}

/**
 * Resolves merge flags based on context.
 *
 * Rules:
 * 1. Merge queue + main button → auto-merge (queue it)
 * 2. Merge queue + explicit admin → admin merge (bypass queue)
 * 3. Standard mode + requirements met → immediate merge
 * 4. Standard mode + no requirements + admin → admin override
 * 5. admin and auto are mutually exclusive
 */
export function resolveMergeStrategy(input: MergeStrategyInput): MergeStrategyOutput {
  const { hasMergeQueue, requirementsMet, canAdmin, explicitAdmin = false, strategy } = input;

  // Explicit admin override from dropdown
  const useExplicitAdmin = explicitAdmin === true;

  // In standard mode (no merge queue), auto-enable admin if requirements not met but user has admin
  // In merge queue mode, NEVER auto-enable admin (only via explicit dropdown selection)
  const useAdmin = useExplicitAdmin || (!hasMergeQueue && !requirementsMet && canAdmin);

  // Auto-merge only in merge queue mode when not using admin
  const useAuto = hasMergeQueue && !useAdmin;

  return {
    admin: useAdmin || undefined,
    auto: useAuto,
    strategy: hasMergeQueue ? "squash" : strategy,
  };
}
