import { QueryClient } from "@tanstack/react-query";

/** Shared react-query client (provided in App.tsx, importable from plain modules such as the AI session actions). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});
