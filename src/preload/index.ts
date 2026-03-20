import { contextBridge, ipcRenderer } from "electron";

import { BADGE_COUNT_CHANNEL, IPC_CHANNEL } from "../shared/ipc";

type IpcResponse = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Expose a minimal, safe API to the renderer process.
 * Access via `window.api`.
 */
contextBridge.exposeInMainWorld("api", {
  /**
   * Call a typed IPC method on the main process.
   */
  invoke(method: string, args: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNEL, { method, args });
  },

  openExternal(url: string): Promise<void> {
    return ipcRenderer
      .invoke(IPC_CHANNEL, {
        method: "app.openExternal",
        args: { url },
      })
      .then((response: IpcResponse) => {
        if (!response.ok) {
          throw new Error(response.error);
        }
      });
  },

  /**
   * Update the dock badge count (macOS).
   */
  setBadgeCount(count: number): void {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return;
    }
    ipcRenderer.send(BADGE_COUNT_CHANNEL, count);
  },

  /**
   * Listen for navigation events from main process (tray menu clicks).
   * Returns a cleanup function to remove the listener.
   */
  onNavigate(callback: (route: { view: string; prNumber?: number }) => void): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      route: { view: string; prNumber?: number },
    ) => {
      callback(route);
    };
    ipcRenderer.on("navigate", handler);
    return () => {
      ipcRenderer.removeListener("navigate", handler);
    };
  },
});
