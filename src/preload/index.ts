import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNEL } from "../shared/ipc";

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

  /**
   * Update the dock badge count (macOS).
   */
  setBadgeCount(count: number): void {
    ipcRenderer.send("set-badge-count", count);
  },

  /**
   * Subscribe to messages from the main process.
   * Returns an unsubscribe function.
   */
  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
