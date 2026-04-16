import { Dialog, DialogClose, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  formatKeybinding,
  type ShortcutCategory,
} from "@/renderer/lib/keyboard/keybinding-registry";
import { Command, Compass, Eye, Search, X, Zap } from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactElement } from "react";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface DisplayRow {
  ids: string[];
  extraShortcuts?: string[][];
  label: string;
  category: ShortcutCategory;
}

const DISPLAY_ROWS: DisplayRow[] = [
  {
    ids: ["navigation.prevPr", "navigation.nextPr"],
    label: "Previous / next PR",
    category: "Navigation",
  },
  { ids: ["navigation.openPr"], label: "Open PR", category: "Navigation" },
  {
    ids: ["navigation.nextRegion", "navigation.prevRegion"],
    label: "Next / previous review pane",
    category: "Navigation",
  },
  { ids: ["navigation.focusFiles"], label: "Focus left review pane", category: "Navigation" },
  { ids: ["navigation.focusDiff"], label: "Focus code view", category: "Navigation" },
  {
    ids: ["navigation.prevFile", "navigation.nextFile"],
    label: "Previous / next file",
    category: "Navigation",
  },
  { ids: ["navigation.toggleSidebar"], label: "Toggle sidebar", category: "Navigation" },
  {
    ids: ["navigation.back", "navigation.forward"],
    label: "Go back / forward",
    category: "Navigation",
  },
  { ids: [], extraShortcuts: [["G", "Q"]], label: "Go queue", category: "Navigation" },
  { ids: ["actions.toggleViewed"], label: "Toggle file viewed", category: "Actions" },
  { ids: ["actions.nextUnreviewed"], label: "Next unreviewed file", category: "Actions" },
  {
    ids: ["actions.togglePanel", "actions.togglePanelAlternate"],
    label: "Toggle overview panel",
    category: "Actions",
  },
  { ids: ["actions.focusPanel"], label: "Focus overview panel", category: "Actions" },
  {
    ids: ["actions.openOverview"],
    extraShortcuts: [["G", "O"]],
    label: "Open overview tab",
    category: "Actions",
  },
  {
    ids: ["actions.openConversation"],
    extraShortcuts: [["G", "C"]],
    label: "Open conversation tab",
    category: "Actions",
  },
  {
    ids: ["actions.openCommits"],
    extraShortcuts: [["G", "T"]],
    label: "Open commits tab",
    category: "Actions",
  },
  {
    ids: ["actions.openChecks"],
    extraShortcuts: [["G", "X"]],
    label: "Open checks tab",
    category: "Actions",
  },
  {
    ids: ["actions.nextComment", "actions.prevComment"],
    label: "Next / previous comment",
    category: "Actions",
  },
  { ids: ["actions.nextUnresolvedThread"], label: "Next unresolved thread", category: "Actions" },
  { ids: ["actions.replyToThread"], label: "Reply to focused thread", category: "Actions" },
  { ids: ["actions.resolveThread"], label: "Resolve focused thread", category: "Actions" },
  { ids: ["actions.focusReviewBar"], label: "Focus review actions bar", category: "Actions" },
  { ids: ["actions.requestChanges"], label: "Request changes", category: "Actions" },
  { ids: ["actions.approve"], label: "Approve PR", category: "Actions" },
  { ids: ["actions.merge"], label: "Merge PR", category: "Actions" },
  { ids: ["search.focusSearch"], label: "Search current pane", category: "Search" },
  {
    ids: ["search.commandPalette", "search.commandPaletteAlt"],
    label: "Command palette",
    category: "Search",
  },
  { ids: ["views.review"], label: "Review", category: "Views" },
  { ids: ["views.workflows"], label: "Workflows", category: "Views" },
  { ids: ["views.metrics"], label: "Metrics", category: "Views" },
  { ids: ["views.releases"], label: "Releases", category: "Views" },
  { ids: ["views.shortcuts"], label: "This dialog", category: "Views" },
];

const CATEGORY_ORDER: ShortcutCategory[] = ["Navigation", "Actions", "Search", "Views"];

const CATEGORY_ICON: Record<ShortcutCategory, typeof Compass> = {
  Navigation: Compass,
  Actions: Zap,
  Search,
  Views: Eye,
};

interface ResolvedRow {
  label: string;
  keys: string[][];
}

interface ResolvedSection {
  title: ShortcutCategory;
  rows: ResolvedRow[];
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps): ReactElement | null {
  const { getBinding } = useKeybindings();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const allSections = useMemo<ResolvedSection[]>(
    () =>
      CATEGORY_ORDER.map((category) => ({
        title: category,
        rows: DISPLAY_ROWS.filter((row) => row.category === category).map((row) => ({
          label: row.label,
          keys: [
            ...row.ids.map((id) => {
              const binding = getBinding(id);
              return [formatKeybinding(binding.key, binding.modifiers)];
            }),
            ...(row.extraShortcuts ?? []),
          ],
        })),
      })),
    [getBinding],
  );

  const filteredSections = useMemo<ResolvedSection[]>(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) {
      return allSections;
    }
    return allSections
      .map((section) => ({
        title: section.title,
        rows: section.rows.filter((row) => {
          if (row.label.toLowerCase().includes(needle)) {
            return true;
          }
          return row.keys.some((group) => group.join(" ").toLowerCase().includes(needle));
        }),
      }))
      .filter((section) => section.rows.length > 0);
  }, [allSections, deferredQuery]);

  const totalCount = useMemo(
    () => allSections.reduce((n, s) => n + s.rows.length, 0),
    [allSections],
  );
  const visibleCount = useMemo(
    () => filteredSections.reduce((n, s) => n + s.rows.length, 0),
    [filteredSections],
  );

  if (!open) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
    >
      <DialogPopup
        className="!max-w-[640px] overflow-hidden !rounded-xl !border-[var(--border)] !bg-[var(--bg-surface)] !p-0"
        showCloseButton={false}
      >
        <style>{`
          @keyframes dispatch-kbd-reveal {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: none; }
          }
          @media (prefers-reduced-motion: reduce) {
            .dispatch-kbd-stagger { animation: none !important; opacity: 1 !important; transform: none !important; }
          }
        `}</style>

        <div
          aria-hidden="true"
          className="h-[2px] w-full"
          style={{
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
            opacity: 0.5,
          }}
        />

        <header className="flex items-start justify-between gap-6 px-6 pt-5 pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className="text-[10px] font-semibold uppercase"
              style={{
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-sans)",
                letterSpacing: "0.14em",
              }}
            >
              Keyboard Reference
            </span>
            <DialogTitle
              className="!text-[30px] !leading-[1.05] !font-normal !tracking-[-0.02em]"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                color: "var(--text-primary)",
              }}
            >
              Shortcuts
            </DialogTitle>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1">
            <span
              className="hidden items-center gap-1.5 text-[10px] sm:inline-flex"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}
            >
              <span>Close</span>
              <Kbd>Esc</Kbd>
            </span>
            <DialogClose
              aria-label="Close shortcuts"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[4px] transition-[background-color,color] duration-[120ms] ease-out focus-visible:ring-2 focus-visible:outline-none"
              style={
                {
                  color: "var(--text-tertiary)",
                  background: "transparent",
                  "--tw-ring-color": "var(--border-accent)",
                } as React.CSSProperties
              }
              render={
                <button
                  type="button"
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-raised)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)";
                  }}
                />
              }
            >
              <X
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
            </DialogClose>
          </div>
        </header>

        <div
          className="mx-6 mb-4 flex items-center gap-2 rounded-[6px] border px-2.5 py-1.5 transition-[border-color,box-shadow] duration-[120ms] ease-out focus-within:shadow-[0_0_20px_rgba(212,136,58,0.08)]"
          style={{
            background: "var(--bg-raised)",
            borderColor: "var(--border)",
          }}
          onFocusCapture={(e) => {
            e.currentTarget.style.borderColor = "var(--border-accent)";
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <Search
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: "var(--text-tertiary)", flexShrink: 0 }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter shortcuts…"
            aria-label="Filter shortcuts"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
            style={{
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              caretColor: "var(--accent)",
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setQuery("")}
              className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] transition-[color,background-color] duration-[120ms] ease-out"
              style={{ color: "var(--text-tertiary)" }}
            >
              <X
                size={11}
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>
          )}
          <span
            className="text-[10px] tabular-nums"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
            }}
            aria-live="polite"
          >
            {visibleCount}/{totalCount}
          </span>
        </div>

        <div
          className="max-h-[60vh] overflow-y-auto overscroll-contain px-6 pb-5"
          style={{ scrollbarWidth: "thin" }}
        >
          {filteredSections.length === 0 ? (
            <EmptyState query={deferredQuery} />
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              {filteredSections.map((section, i) => (
                <CategoryBlock
                  key={section.title}
                  section={section}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>

        <footer
          className="flex items-center justify-between gap-4 border-t px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-root)" }}
        >
          <span
            className="text-[10px] uppercase"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              letterSpacing: "0.1em",
            }}
          >
            Press <Kbd>?</Kbd> anytime
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-[10px]"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}
          >
            <Command
              size={10}
              strokeWidth={2}
              aria-hidden="true"
            />
            <span>{"Palette"}</span>
            <Kbd>{"⌘\u00A0K"}</Kbd>
          </span>
        </footer>
      </DialogPopup>
    </Dialog>
  );
}

function CategoryBlock({
  section,
  index,
}: {
  section: ResolvedSection;
  index: number;
}): ReactElement {
  const Icon = CATEGORY_ICON[section.title];
  return (
    <section
      className="dispatch-kbd-stagger flex flex-col gap-2"
      style={{
        animation: "dispatch-kbd-reveal 240ms cubic-bezier(0.16, 1, 0.3, 1) both",
        animationDelay: `${60 + index * 45}ms`,
      }}
    >
      <div
        className="flex items-center gap-2 border-b pb-1"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Icon
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{ color: "var(--accent-text)", opacity: 0.85 }}
        />
        <h3
          className="!text-[14px] !leading-none !font-normal !tracking-[-0.01em]"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            color: "var(--text-primary)",
          }}
        >
          {section.title}
        </h3>
        <span
          className="ml-auto text-[9px] tabular-nums"
          style={{
            color: "var(--text-ghost)",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {section.rows.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {section.rows.map((row) => (
          <li
            key={row.label}
            className="group flex items-center justify-between gap-3"
          >
            <span
              className="min-w-0 truncate text-[12px]"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--font-sans)",
              }}
              title={row.label}
            >
              {row.label}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {row.keys.map((group, groupIdx) => (
                <span
                  key={`${group.join("-")}-${groupIdx}`}
                  className="flex items-center gap-0.5"
                >
                  {groupIdx > 0 && (
                    <span
                      aria-hidden="true"
                      className="text-[9px]"
                      style={{ color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}
                    >
                      ·
                    </span>
                  )}
                  {group.map((key, keyIdx) => (
                    <span
                      key={key + keyIdx}
                      className="flex items-center gap-0.5"
                    >
                      {keyIdx > 0 && (
                        <span
                          aria-hidden="true"
                          className="text-[9px]"
                          style={{ color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}
                        >
                          then
                        </span>
                      )}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <kbd
      className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[4px] border px-[5px] text-[10px] font-medium transition-colors duration-[120ms]"
      style={{
        fontFamily: "var(--font-mono)",
        background: "var(--bg-raised)",
        borderColor: "var(--border-strong)",
        boxShadow: "0 1px 0 var(--border)",
        color: "var(--text-secondary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </kbd>
  );
}

function EmptyState({ query }: { query: string }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p
        className="!text-[22px] !leading-[1.1] !tracking-[-0.02em]"
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          color: "var(--text-primary)",
        }}
      >
        Nothing matches
      </p>
      <p
        className="text-[12px]"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}
      >
        No shortcut for {"\u2018"}
        <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
          {query}
        </span>
        {"\u2019"}. Try a different word.
      </p>
    </div>
  );
}
