import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "./lib/trpc";
import { AppLayout } from "./components/app-layout";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
    </QueryClientProvider>
  );
}
