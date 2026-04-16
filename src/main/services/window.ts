import type { BrowserWindow } from "electron";

export function showAndFocusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}
