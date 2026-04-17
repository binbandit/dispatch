import type * as React from "react";

type SearchInputEscapeEvent = Pick<
  React.KeyboardEvent<HTMLInputElement>,
  "currentTarget" | "key" | "preventDefault" | "stopPropagation"
>;

export function handleSearchInputEscape(
  event: SearchInputEscapeEvent,
  options?: {
    onEscape?: () => void;
    preventDefault?: boolean;
    stopPropagation?: boolean;
  },
): boolean {
  if (event.key !== "Escape") {
    return false;
  }

  if (options?.preventDefault ?? true) {
    event.preventDefault();
  }

  if (options?.stopPropagation) {
    event.stopPropagation();
  }

  event.currentTarget.blur();
  options?.onEscape?.();

  return true;
}
