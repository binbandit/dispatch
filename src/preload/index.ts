import { contextBridge, ipcRenderer } from "electron";

import {
  ACP_PERMISSION_CHANNEL,
  ACP_UPDATE_CHANNEL,
  ANALYTICS_CHANNEL,
  BADGE_COUNT_CHANNEL,
  IPC_CHANNEL,
} from "../shared/ipc";

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
  onNavigate(
    callback: (route: { view: string; prNumber?: number; workspacePath?: string }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      route: { view: string; prNumber?: number; workspacePath?: string },
    ) => {
      callback(route);
    };
    ipcRenderer.on("navigate", handler);
    return () => {
      ipcRenderer.removeListener("navigate", handler);
    };
  },

  /**
   * Listen for analytics events sent from the main process.
   * Returns a cleanup function to remove the listener.
   */
  onAnalyticsTrack(
    callback: (payload: {
      event: string;
      properties?: Record<string, string | number | boolean>;
    }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { event: string; properties?: Record<string, string | number | boolean> },
    ) => {
      callback(payload);
    };
    ipcRenderer.on(ANALYTICS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(ANALYTICS_CHANNEL, handler);
    };
  },

  /**
   * Listen for ACP session update events (streaming content, tool calls).
   * Returns a cleanup function to remove the listener.
   */
  onAcpUpdate(
    callback: (event: {
      sessionId: string;
      update: { sessionUpdate: string; [key: string]: unknown };
    }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; update: { sessionUpdate: string; [key: string]: unknown } },
    ) => {
      callback(payload);
    };
    ipcRenderer.on(ACP_UPDATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(ACP_UPDATE_CHANNEL, handler);
    };
  },

  /**
   * Listen for ACP permission requests from agents.
   * Returns a cleanup function to remove the listener.
   */
  onAcpPermission(
    callback: (event: {
      requestId: string;
      sessionId: string;
      toolCallId: string;
      toolName: string;
      options: Array<{ optionId: string; name: string; kind: string }>;
    }) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        requestId: string;
        sessionId: string;
        toolCallId: string;
        toolName: string;
        options: Array<{ optionId: string; name: string; kind: string }>;
      },
    ) => {
      callback(payload);
    };
    ipcRenderer.on(ACP_PERMISSION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(ACP_PERMISSION_CHANNEL, handler);
    };
  },
});
