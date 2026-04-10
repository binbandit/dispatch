import type { DevRepoStatus } from "../../ipc";

export interface AppIpcApi {
  "preferences.get": { args: { key: string }; result: string | null };
  "preferences.set": { args: { key: string; value: string }; result: void };
  "preferences.getAll": {
    args: { keys: string[] };
    result: Record<string, string | null>;
  };
  "preferences.deleteMany": { args: { keys: string[] }; result: void };
  "app.openExternal": { args: { url: string }; result: void };
  "app.devRepoStatus": { args: { cwd: string | null }; result: DevRepoStatus };
  "app.setTrafficLightPosition": { args: { x: number; y: number }; result: void };
  "app.nuke": { args: void; result: void };
}
