import { QueryClient } from "@tanstack/react-query";

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
