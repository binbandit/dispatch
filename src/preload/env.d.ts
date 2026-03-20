/**
 * Type declarations for the preload API exposed via contextBridge.
 */
export {};
declare global {
  interface ElectronApi {
    invoke(method: string, args: unknown): Promise<unknown>;
    openExternal(url: string): Promise<void>;
    setBadgeCount(count: number): void;
    onNavigate(callback: (route: { view: string; prNumber?: number }) => void): () => void;
  }

  interface Window {
    api: ElectronApi;
  }
}
