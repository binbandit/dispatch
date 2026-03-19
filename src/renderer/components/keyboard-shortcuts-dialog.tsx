import {
  Dialog,
  DialogClose,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

/**
 * Keyboard shortcuts reference dialog — Phase 4 §D2
 *
 * Triggered by pressing ? anywhere in the app.
 */

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["j", "k"], description: "Previous / next PR" },
      { keys: ["Enter"], description: "Open PR" },
      { keys: ["[", "]"], description: "Previous / next file" },
      { keys: ["Cmd+B"], description: "Toggle sidebar" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["a"], description: "Approve PR" },
      { keys: ["v"], description: "Toggle file viewed" },
      { keys: ["n"], description: "Next unreviewed file" },
    ],
  },
  {
    title: "Search",
    shortcuts: [
      { keys: ["/"], description: "Focus search" },
      { keys: ["Cmd+F"], description: "Search in diff" },
      { keys: ["Esc"], description: "Clear / close" },
    ],
  },
  {
    title: "Views",
    shortcuts: [
      { keys: ["1"], description: "Review" },
      { keys: ["2"], description: "Workflows" },
      { keys: ["3"], description: "Metrics" },
      { keys: ["4"], description: "Releases" },
      { keys: ["?"], description: "This dialog" },
    ],
  },
];

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
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
          {SECTIONS.map((section) => (
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
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={key}
                          className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1.5 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]"
                        >
                          {key}
                        </kbd>
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
