import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { ThemeProvider } from "@happynails/ui";
import { ApiError } from "./lib/api";
import { HomePage } from "./home/HomePage";
import { Layout } from "./layout/Layout";
import { NotFound } from "./NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (404 and friends) will not fix themselves; retry only network and server failures.
      retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
