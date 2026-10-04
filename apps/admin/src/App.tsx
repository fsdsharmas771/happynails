import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { ThemeProvider } from "@happynails/ui";
import { AuthGate } from "./auth";
import { ApiError } from "./lib/api";
import { AvailabilityPage } from "./pages/Availability";
import { BookingsPage } from "./pages/Bookings";
import { ServicesPage, TestimonialsPage } from "./pages/Content";
import { DashboardPage } from "./pages/Dashboard";
import { GstPage, InvoiceAdminPage } from "./pages/Gst";
import { OrderDetailPage, OrdersPage } from "./pages/Orders";
import { ProductsPage } from "./pages/Products";
import { TechniciansPage } from "./pages/Team";
import { Shell } from "./Shell";

// A 401 anywhere means the session ended: drop back to the sign-in form.
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(["me"], null);
};
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status < 500),
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthGate>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<DashboardPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="orders/:id" element={<OrderDetailPage />} />
                <Route path="bookings" element={<BookingsPage />} />
                <Route path="availability" element={<AvailabilityPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="technicians" element={<TechniciansPage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="testimonials" element={<TestimonialsPage />} />
                <Route path="gst" element={<GstPage />} />
                <Route path="invoice" element={<InvoiceAdminPage />} />
                <Route path="*" element={<p className="note">Page not found.</p>} />
              </Route>
            </Routes>
          </AuthGate>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
