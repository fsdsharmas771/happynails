import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PaymentMethod, ShippingSpeed } from "@happynails/shared";
import { api } from "../lib/api";
import { useCart } from "./store";

/** Server-priced view of the bag. Every total shown anywhere comes from here. */
export function useQuote(
  shippingSpeed: ShippingSpeed = "standard",
  paymentMethod: PaymentMethod = "razorpay",
) {
  const items = useCart((s) => s.items);
  return useQuery({
    queryKey: ["quote", items, shippingSpeed, paymentMethod],
    queryFn: () => api.quote({ items, shippingSpeed, paymentMethod }),
    enabled: items.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
