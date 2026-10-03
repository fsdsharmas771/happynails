import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductDetailResponse, ProductListResponse } from "@happynails/shared";
import { api } from "../lib/api";

const productsKey = ["products"] as const;

export function useProducts() {
  return useQuery({ queryKey: productsKey, queryFn: api.products, staleTime: 60_000 });
}

/** One set; starts from the list cache so the drawer opens instantly from the grid. */
export function useProduct(slug: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.product(slug!),
    enabled: !!slug,
    staleTime: 60_000,
    initialData: (): ProductDetailResponse | undefined => {
      const list = qc.getQueryData<ProductListResponse>(productsKey);
      const product = list?.products.find((p) => p.slug === slug);
      return product && list ? { product, sizingOptions: list.sizingOptions } : undefined;
    },
    initialDataUpdatedAt: () => qc.getQueryState(productsKey)?.dataUpdatedAt,
  });
}
