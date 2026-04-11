/**
 * Type declarations for the preload API exposed via contextBridge.
 */

declare global {
  interface ElectronApi {
    invoke(method: string, args: unknown): Promise<unknown>;
    openExternal(url: string): Promise<void>;
    setBadgeCount(count: number): void;
    onNavigate(
      callback: (route: { view: string; prNumber?: number; workspacePath?: string }) => void,
    ): () => void;
    onAnalyticsTrack(
      callback: (payload: {
        event: string;
        properties?: Record<string, string | number | boolean>;
      }) => void,
    ): () => void;
    onWindowStateChange(callback: (state: { isFullscreen: boolean }) => void): () => void;
  }

  var api: ElectronApi;

  interface Window {
    api: ElectronApi;
  }
}

export type PreloadApi = ElectronApi;
