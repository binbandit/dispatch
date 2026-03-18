import { initTRPC } from "@trpc/server";

/**
 * tRPC initialization for the main process.
 *
 * No transformer needed — IPC uses Electron's structured clone
 * which handles Dates, Maps, etc. natively.
 */
const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
