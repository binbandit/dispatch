import {
  Dialog,
  DialogClose,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  formatKeybinding,
  type ShortcutCategory,
} from "@/renderer/lib/keyboard/keybinding-registry";
import { X } from "lucide-react";
import { useMemo } from "react";

/**
 * Keyboard shortcuts reference dialog — Phase 4 §D2
 *
 * Triggered by pressing ? anywhere in the app.
 * Now data-driven from the centralized keybinding registry,
 * reflecting any user customizations.
 */

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Display rows — pairs shortcuts that should share a row
 * (e.g. "j / k" for "Previous / next PR").
 */
const DISPLAY_ROWS: Array<{
  ids: string[];
  extraShortcuts?: string[][];
  label: string;
  category: ShortcutCategory;
}> = [
  // Navigation
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
  // Actions
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
  {
    ids: ["actions.nextUnresolvedThread"],
    label: "Next unresolved thread",
    category: "Actions",
  },
  { ids: ["actions.replyToThread"], label: "Reply to focused thread", category: "Actions" },
  { ids: ["actions.resolveThread"], label: "Resolve focused thread", category: "Actions" },
  { ids: ["actions.focusReviewBar"], label: "Focus review actions bar", category: "Actions" },
  { ids: ["actions.requestChanges"], label: "Request changes", category: "Actions" },
  { ids: ["actions.approve"], label: "Approve PR", category: "Actions" },
  { ids: ["actions.merge"], label: "Merge PR", category: "Actions" },
  // Search
  { ids: ["search.focusSearch"], label: "Search current pane", category: "Search" },
  {
    ids: ["search.commandPalette", "search.commandPaletteAlt"],
    label: "Command palette",
    category: "Search",
  },
  // Views
  { ids: ["views.review"], label: "Review", category: "Views" },
  { ids: ["views.workflows"], label: "Workflows", category: "Views" },
  { ids: ["views.metrics"], label: "Metrics", category: "Views" },
  { ids: ["views.releases"], label: "Releases", category: "Views" },
  { ids: ["views.shortcuts"], label: "This dialog", category: "Views" },
];

const CATEGORY_ORDER: ShortcutCategory[] = ["Navigation", "Actions", "Search", "Views"];

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const { getBinding } = useKeybindings();

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        title: category,
        shortcuts: DISPLAY_ROWS.filter((row) => row.category === category).map((row) => ({
          keys: [
            ...row.ids.map((id) => {
              const binding = getBinding(id);
              return [formatKeybinding(binding.key, binding.modifiers)];
            }),
            ...(row.extraShortcuts ?? []),
          ],
          description: row.label,
        })),
      })),
    [getBinding],
  );

  if (!open) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
    >
      <DialogPopup className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogClose
            render={
              <button
                type="button"
                className="text-text-tertiary hover:text-text-primary absolute top-4 right-4 cursor-pointer"
              />
            }
          >
            <X size={14} />
          </DialogClose>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6 px-6 pb-6">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
                {section.title}
              </h3>
              <div className="flex flex-col gap-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between"
                  >
                    <span className="text-text-secondary text-xs">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((shortcutKeys) => (
                        <span
                          key={shortcutKeys.join(" ")}
                          className="flex items-center gap-1"
                        >
                          {shortcutKeys.map((key) => (
                            <kbd
                              key={key}
                              className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1.5 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]"
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
