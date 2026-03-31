/**
 * Public surface for the GitHub CLI adapter.
 *
 * Domain implementations live in `./gh-cli/*` so the main process can depend
 * on smaller modules while existing imports continue to target this file.
 */

export * from "./gh-cli/core";
export * from "./gh-cli/insights";
export * from "./gh-cli/prs";
export * from "./gh-cli/workflows";
