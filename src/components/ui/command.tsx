"use client";

import type * as React from "react";

import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteSeparator,
} from "@/components/ui/autocomplete";
import { cn } from "@/lib/utils";
import { Dialog as CommandDialogPrimitive } from "@base-ui/react/dialog";
import { SearchIcon } from "lucide-react";
import { createContext, useContext, useId, useMemo, useState } from "react";

export const CommandDialog: typeof CommandDialogPrimitive.Root = CommandDialogPrimitive.Root;

export const CommandDialogPortal: typeof CommandDialogPrimitive.Portal =
  CommandDialogPrimitive.Portal;

export const CommandCreateHandle: typeof CommandDialogPrimitive.createHandle =
  CommandDialogPrimitive.createHandle;

export function CommandDialogTrigger(
  props: CommandDialogPrimitive.Trigger.Props,
): React.ReactElement {
  return (
    <CommandDialogPrimitive.Trigger
      data-slot="command-dialog-trigger"
      {...props}
    />
  );
}

export function CommandDialogBackdrop({
  className,
  ...props
}: CommandDialogPrimitive.Backdrop.Props): React.ReactElement {
  return (
    <CommandDialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="command-dialog-backdrop"
      {...props}
    />
  );
}

export function CommandDialogViewport({
  className,
  ...props
}: CommandDialogPrimitive.Viewport.Props): React.ReactElement {
  return (
    <CommandDialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center px-4 py-[max(--spacing(4),4vh)] sm:py-[10vh]",
        className,
      )}
      data-slot="command-dialog-viewport"
      {...props}
    />
  );
}

export function CommandDialogPopup({
  className,
  children,
  ...props
}: CommandDialogPrimitive.Popup.Props): React.ReactElement {
  return (
    <CommandDialogPortal>
      <CommandDialogBackdrop />
      <CommandDialogViewport>
        <CommandDialogPrimitive.Popup
          className={cn(
            "bg-popover text-popover-foreground before:bg-muted/72 relative row-start-2 flex max-h-105 min-h-0 w-full max-w-xl min-w-0 -translate-y-[calc(1.25rem*var(--nested-dialogs))] scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-2xl border opacity-[calc(1-0.1*var(--nested-dialogs))] shadow-lg/5 transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform outline-none not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-ending-style:opacity-0 data-nested:data-ending-style:translate-y-8 data-nested-dialog-open:origin-top data-starting-style:scale-98 data-starting-style:opacity-0 data-nested:data-starting-style:translate-y-8 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="command-dialog-popup"
          {...props}
        >
          {children}
        </CommandDialogPrimitive.Popup>
      </CommandDialogViewport>
    </CommandDialogPortal>
  );
}

// ---------------------------------------------------------------------------
// Search / filter context
// ---------------------------------------------------------------------------

const CommandQueryContext = createContext("");

/** Read the current raw command palette search query. */
export function useCommandQuery(): string {
  return useContext(CommandQueryContext);
}

/** Case-insensitive substring match. */
export function commandMatch(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

// ---------------------------------------------------------------------------
// Smart filter parsing
// ---------------------------------------------------------------------------

export interface ParsedCommandQuery {
  /** Free-text portion after removing structured filters. */
  text: string;
  /** `#1234` or `pr:1234` — exact PR number. */
  pr?: number;
  /** `@name` or `author:name` — substring match on author login. */
  author?: string;
  /** `branch:name` — substring match on head/base ref. */
  branch?: string;
  /** `is:draft`, `is:approved`, `is:open`, etc. */
  is: string[];
  /** `size:s`, `size:m`, `size:l`, `size:xl` */
  size?: string;
  /** `label:bug` — substring match on label name. */
  label?: string;
  /** `file:tsx` or `ext:tsx` — match file extension/path. */
  file?: string;
  /** True when any structured filter is present (not just free text). */
  hasFilters: boolean;
}

const FILTER_RE =
  /(?:#(\d+))|(?:@(\S+))|(?:\b(pr|author|branch|is|size|label|file|ext|review|state):(\S+))/gi;

export function parseCommandQuery(raw: string): ParsedCommandQuery {
  const result: ParsedCommandQuery = { text: "", is: [], hasFilters: false };
  let text = raw;

  // Walk all structured tokens and strip them from the text
  for (const m of raw.matchAll(FILTER_RE)) {
    const full = m[0];

    if (m[1]) {
      // #1234
      result.pr = Number.parseInt(m[1], 10);
    } else if (m[2]) {
      // @author
      result.author = m[2];
    } else if (m[3] && m[4]) {
      const key = m[3].toLowerCase();
      const val = m[4];
      switch (key) {
        case "pr":
          result.pr = Number.parseInt(val, 10);
          break;
        case "author":
          result.author = val;
          break;
        case "branch":
          result.branch = val;
          break;
        case "is":
        case "state":
        case "review":
          result.is.push(val.toLowerCase());
          break;
        case "size":
          result.size = val.toLowerCase();
          break;
        case "label":
          result.label = val;
          break;
        case "file":
        case "ext":
          result.file = val;
          break;
      }
    }
    text = text.replace(full, "");
    result.hasFilters = true;
  }

  result.text = text.replace(/\s+/g, " ").trim();
  return result;
}

/**
 * Parsed command query — reactive hook version.
 * Returns both the structured filters and the free-text query.
 */
export function useCommandFilters(): ParsedCommandQuery {
  const raw = useContext(CommandQueryContext);
  return useMemo(() => parseCommandQuery(raw), [raw]);
}

// ---------------------------------------------------------------------------
// Core components
// ---------------------------------------------------------------------------

export function Command({
  autoHighlight = "always",
  keepHighlight = true,
  onValueChange,
  ...props
}: React.ComponentProps<typeof Autocomplete>): React.ReactElement {
  const [query, setQuery] = useState("");
  return (
    <CommandQueryContext.Provider value={query}>
      <Autocomplete
        autoHighlight={autoHighlight}
        keepHighlight={keepHighlight}
        onValueChange={(value: string, details) => {
          setQuery(value);
          onValueChange?.(value, details);
        }}
        open
        {...props}
      />
    </CommandQueryContext.Provider>
  );
}

export function CommandInput({
  className,
  placeholder = undefined,
  ...props
}: React.ComponentProps<typeof AutocompleteInput>): React.ReactElement {
  return (
    <div className="px-2.5 py-1.5">
      <AutocompleteInput
        autoFocus
        className={cn(
          "border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0",
          className,
        )}
        placeholder={placeholder}
        size="lg"
        startAddon={<SearchIcon />}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteList>): React.ReactElement {
  return (
    <AutocompleteList
      className={cn("not-empty:scroll-py-2 not-empty:p-2", className)}
      data-slot="command-list"
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteEmpty>): React.ReactElement {
  return (
    <AutocompleteEmpty
      className={cn("not-empty:py-6", className)}
      data-slot="command-empty"
      {...props}
    />
  );
}

export function CommandPanel({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className="bg-popover relative -mx-px min-h-0 rounded-t-xl border border-b-0 bg-clip-padding shadow-xs/5 [clip-path:inset(0_1px)] not-has-[+[data-slot=command-footer]]:-mb-px not-has-[+[data-slot=command-footer]]:rounded-b-2xl not-has-[+[data-slot=command-footer]]:[clip-path:inset(0_1px_1px_1px_round_0_0_calc(var(--radius-2xl)-1px)_calc(var(--radius-2xl)-1px))] before:pointer-events-none before:absolute before:inset-0 before:rounded-t-[calc(var(--radius-xl)-1px)] **:data-[slot=scroll-area-scrollbar]:mt-2"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteGroup>): React.ReactElement {
  return (
    <AutocompleteGroup
      className={cn("[[role=group]+&]:border-t [[role=group]+&]:pt-2", className)}
      data-slot="command-group"
      {...props}
    />
  );
}

export function CommandGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteGroupLabel>): React.ReactElement {
  return (
    <AutocompleteGroupLabel
      className={className}
      data-slot="command-group-label"
      {...props}
    />
  );
}

export function CommandCollection({
  ...props
}: React.ComponentProps<typeof AutocompleteCollection>): React.ReactElement {
  return (
    <AutocompleteCollection
      data-slot="command-collection"
      {...props}
    />
  );
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

export function CommandItem({
  className,
  onSelect,
  value,
  children,
  ...props
}: React.ComponentProps<typeof AutocompleteItem> & {
  onSelect?: () => void;
}): React.ReactElement {
  const id = useId();
  const textValue = value ?? (extractText(children) || id);
  return (
    <AutocompleteItem
      className={cn("py-1.5", className)}
      data-slot="command-item"
      onClick={() => onSelect?.()}
      value={textValue}
      {...props}
    >
      {children}
    </AutocompleteItem>
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteSeparator>): React.ReactElement {
  return (
    <AutocompleteSeparator
      className={cn("my-2", className)}
      data-slot="command-separator"
      {...props}
    />
  );
}

export function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "text-muted-foreground/72 ms-auto font-sans text-xs font-medium tracking-widest",
        className,
      )}
      data-slot="command-shortcut"
      {...props}
    />
  );
}

export function CommandFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center justify-between gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t px-5 py-3 text-xs",
        className,
      )}
      data-slot="command-footer"
      {...props}
    />
  );
}

export { CommandDialogPrimitive };
