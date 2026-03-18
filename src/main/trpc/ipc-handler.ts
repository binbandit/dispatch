import { ipcMain } from "electron";

import { TRPC_IPC_CHANNEL } from "../../shared/ipc";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

/**
 * Register the tRPC IPC handler on the main process.
 *
 * Uses tRPC's createCallerFactory for a clean server-side call.
 * The renderer sends { path, input } and we route it to the
 * correct procedure via the caller.
 */
export function registerTrpcIpcHandler(): void {
  const createCaller = createCallerFactory(appRouter);
  const caller = createCaller({});

  ipcMain.handle(
    TRPC_IPC_CHANNEL,
    async (_event, payload: { type: "query" | "mutation"; path: string; input: unknown }) => {
      const { path, input } = payload;

      try {
        // Navigate the caller object using the dot-separated path
        // e.g. "env.check" → caller.env.check(input)
        const segments = path.split(".");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = caller;
        for (const segment of segments) {
          current = current[segment];
        }

        const result = await current(input);

        return { ok: true, data: result };
      } catch (error) {
        return {
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  );
}
