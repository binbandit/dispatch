import type { AppRouter } from "../../main/trpc/router";
import type { TRPCLink } from "@trpc/client";

import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError, createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

/**
 * Custom tRPC link that routes calls through Electron's IPC bridge.
 *
 * The main process uses a tRPC caller factory — no HTTP, no superjson.
 * Data is passed via Electron's structured clone (handles Dates, etc.).
 */
function ipcLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const { type, path, input } = op;

        window.api
          .trpc({ type: type as "query" | "mutation", path, input })
          .then((response) => {
            const res = response as { ok: boolean; data?: unknown; error?: { message: string } };

            if (!res.ok) {
              observer.error(
                TRPCClientError.from(new Error(res.error?.message ?? "Unknown IPC error")),
              );
            } else {
              observer.next({ result: { type: "data", data: res.data } });
              observer.complete();
            }
          })
          .catch((err) => {
            observer.error(
              TRPCClientError.from(err instanceof Error ? err : new Error(String(err))),
            );
          });
      });
}

/**
 * Singleton QueryClient for the renderer process.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * tRPC vanilla client using the IPC link.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});

/**
 * tRPC + TanStack React Query integration.
 */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
