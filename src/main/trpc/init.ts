import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * tRPC initialization for the main process.
 *
 * Context is empty — we don't have user sessions.
 * SuperJSON transformer handles Date, Map, Set, etc. across IPC.
 */
const t = initTRPC.create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
