/**
 * Type declarations for the preload API exposed via contextBridge.
 */
interface ElectronApi {
  invoke(method: string, args: unknown): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}

interface Window {
  api: ElectronApi;
}
