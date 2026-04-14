import type { SearchablePrItem } from "@/renderer/lib/inbox/pr-search";

import { Kbd } from "@/components/ui/kbd";
import {
  type SearchSuggestion,
  applySuggestion,
  getSearchSuggestions,
} from "@/renderer/lib/inbox/search-autocomplete";
import { HelpCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Autocomplete dropdown
// ---------------------------------------------------------------------------

interface SearchAutocompleteProps {
  query: string;
  cursorPosition: number;
  items: SearchablePrItem[];
  visible: boolean;
  onAccept: (newQuery: string, newCursor: number) => void;
  onDismiss: () => void;
  /** Ref forwarded so parent can call imperative methods */
  actionRef: React.RefObject<SearchAutocompleteActions | null>;
}

export interface SearchAutocompleteActions {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

export function SearchAutocomplete({
  query,
  cursorPosition,
  items,
  visible,
  onAccept,
  onDismiss,
  actionRef,
}: SearchAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { suggestions, token } = useMemo(
    () =>
      visible
        ? getSearchSuggestions(query, cursorPosition, items)
        : { suggestions: [], token: null },
    [query, cursorPosition, items, visible],
  );

  // Reset selection when suggestions change
  const suggestionsKey = suggestions.map((s) => s.completion).join(",");
  const prevKeyRef = useRef(suggestionsKey);
  if (prevKeyRef.current !== suggestionsKey) {
    prevKeyRef.current = suggestionsKey;
    if (selectedIndex >= suggestions.length) {
      setSelectedIndex(0);
    }
  }

  const accept = useCallback(
    (suggestion: SearchSuggestion) => {
      const result = applySuggestion(query, token, suggestion);
      onAccept(result.query, result.cursor);
    },
    [query, token, onAccept],
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Expose keyboard handler to parent
  const actionsValue = useMemo<SearchAutocompleteActions>(
    () => ({
      handleKeyDown(e: React.KeyboardEvent): boolean {
        if (suggestions.length === 0) {
          return false;
        }

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % suggestions.length);
          return true;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return true;
        }

        if (e.key === "Tab") {
          e.preventDefault();
          const s = suggestions[selectedIndex];
          if (s) {
            accept(s);
          }
          return true;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          onDismiss();
          return true;
        }

        return false;
      },
    }),
    [suggestions, selectedIndex, accept, onDismiss],
  );

  // Keep ref in sync without effect — assign during render
  const ref = actionRef as React.MutableRefObject<SearchAutocompleteActions | null>;
  ref.current = actionsValue;

  if (!visible || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      className="border-border bg-bg-elevated absolute top-full right-0 left-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-md border shadow-md"
      role="listbox"
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.completion}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
            index === selectedIndex
              ? "bg-accent-muted text-text-primary"
              : "text-text-secondary hover:bg-bg-raised"
          }`}
          onClick={() => accept(suggestion)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="text-accent-text font-mono text-[11px]">{suggestion.label}</span>
          {suggestion.hint && (
            <span className="text-text-tertiary truncate text-[10px]">{suggestion.hint}</span>
          )}
        </button>
      ))}
      <div className="border-border text-text-ghost flex items-center gap-1.5 border-t px-2 py-1 text-[10px]">
        <Kbd className="h-3.5 min-w-3.5 px-0.5 font-mono text-[9px]">Tab</Kbd>
        <span>accept</span>
        <Kbd className="ml-1 h-3.5 min-w-3.5 px-0.5 font-mono text-[9px]">&uarr;&darr;</Kbd>
        <span>navigate</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search help popover
// ---------------------------------------------------------------------------

const HELP_SECTIONS = [
  {
    title: "Filter by field",
    items: [
      { syntax: "is:draft", desc: "Draft PRs" },
      { syntax: "is:approved", desc: "Approved PRs" },
      { syntax: "is:new", desc: "New activity" },
      { syntax: "is:review", desc: "Review requested" },
      { syntax: "size:s|m|l|xl", desc: "PR size" },
      { syntax: "author:name", desc: "Author login or name" },
      { syntax: "repo:name", desc: "Repository" },
      { syntax: "base:branch", desc: "Target branch" },
      { syntax: "head:branch", desc: "Source branch" },
    ],
  },
  {
    title: "Shortcuts",
    items: [
      { syntax: "@username", desc: "Author shortcut" },
      { syntax: "#123", desc: "PR number" },
      { syntax: '"exact match"', desc: "Quoted phrase" },
    ],
  },
  {
    title: "Modifiers",
    items: [
      { syntax: "-term", desc: "Exclude results" },
      { syntax: "!author:bot", desc: "Negated filter" },
    ],
  },
] as const;

export function SearchHelpPopover() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div
      ref={popoverRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-text-ghost hover:text-text-tertiary flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm transition-colors ${open ? "text-text-tertiary" : ""}`}
        aria-label="Search syntax help"
      >
        <HelpCircle size={12} />
      </button>

      {open && (
        <div className="border-border bg-bg-elevated absolute top-full right-0 z-50 mt-2 w-64 rounded-md border shadow-md">
          <div className="flex items-center justify-between border-b border-[--border] px-3 py-2">
            <span className="text-text-primary text-xs font-medium">Search syntax</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-text-ghost hover:text-text-tertiary cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {HELP_SECTIONS.map((section) => (
              <div
                key={section.title}
                className="mb-2 last:mb-0"
              >
                <div className="text-text-tertiary mb-1 px-1 text-[10px] font-medium tracking-wide uppercase">
                  {section.title}
                </div>
                {section.items.map((item) => (
                  <div
                    key={item.syntax}
                    className="flex items-baseline gap-2 rounded-sm px-1 py-0.5"
                  >
                    <code className="text-accent-text shrink-0 font-mono text-[11px]">
                      {item.syntax}
                    </code>
                    <span className="text-text-tertiary text-[10px]">{item.desc}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
