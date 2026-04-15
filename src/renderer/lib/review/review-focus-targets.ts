export const REVIEW_FOCUS_TARGET_ATTRIBUTE = "data-review-focus-target";

export type ReviewFocusTarget =
  | "file-search"
  | "file-tree"
  | "diff-viewer"
  | "panel-tabs"
  | "panel-overview"
  | "panel-conversation"
  | "panel-commits"
  | "panel-checks"
  | "review-actions";

interface FocusReviewTargetOptions {
  preferDescendant?: boolean;
  selectText?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getTargetSelector(target: ReviewFocusTarget): string {
  return `[${REVIEW_FOCUS_TARGET_ATTRIBUTE}="${target}"]`;
}

export function focusReviewTarget(
  target: ReviewFocusTarget,
  { preferDescendant = false, selectText = false }: FocusReviewTargetOptions = {},
): boolean {
  const root = document.querySelector<HTMLElement>(getTargetSelector(target));
  if (!root) {
    return false;
  }

  const nextFocus = preferDescendant
    ? (root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? root)
    : root;
  nextFocus.focus({ preventScroll: true });

  if (
    selectText &&
    (nextFocus instanceof HTMLInputElement || nextFocus instanceof HTMLTextAreaElement)
  ) {
    nextFocus.select();
  }

  return true;
}

export function focusReviewTargetSoon(
  target: ReviewFocusTarget,
  options?: FocusReviewTargetOptions,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      focusReviewTarget(target, options);
    });
  });
}
