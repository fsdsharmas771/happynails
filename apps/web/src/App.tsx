import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { ThemeProvider } from "@happynails/ui";
import { ApiError } from "./lib/api";
import { HomePage } from "./home/HomePage";
import { Layout } from "./layout/Layout";
import { NotFound } from "./NotFound";
import { lazy, Suspense } from "react";

// Checkout (with Razorpay) and order tracking are separate pages: split them out of the main bundle.
const CheckoutPage = lazy(() => import("./checkout/CheckoutPage").then((m) => ({ default: m.CheckoutPage })));
const OrderPage = lazy(() => import("./orders/OrderPage").then((m) => ({ default: m.OrderPage })));
const Loading = () => (
  <p className="note" style={{ padding: 40 }}>
    Loading
  </p>
);

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
            <Route
              path="checkout"
              element={
                <Suspense fallback={<Loading />}>
                  <CheckoutPage />
                </Suspense>
              }
            />
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route
                path="order/:number"
                element={
                  <Suspense fallback={<Loading />}>
                    <OrderPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
