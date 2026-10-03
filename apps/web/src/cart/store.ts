import { cartItemSchema, MAX_QTY_PER_LINE, type CartItem } from "@happynails/shared";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

interface CartState {
  /** Slug, sizing option and quantity only. Prices always come from the server. */
  items: CartItem[];
  add: (item: CartItem) => void;
}

// localStorage can throw (private mode, blocked site data); the bag then lasts for this visit only.
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: ({ slug, option, qty }) =>
        set((s) => {
          const existing = s.items.find((i) => i.slug === slug && i.option === option);
          if (!existing)
            return { items: [...s.items, { slug, option, qty: Math.min(qty, MAX_QTY_PER_LINE) }] };
          return {
            items: s.items.map((i) =>
              i === existing ? { ...i, qty: Math.min(i.qty + qty, MAX_QTY_PER_LINE) } : i,
            ),
          };
        }),
    }),
    {
      name: "hn-cart",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ items: s.items }),
      // Anything malformed in storage (old versions, hand edits) is dropped rather than trusted.
      merge: (persisted, current) => {
        const items = cartItemSchema.array().safeParse((persisted as { items?: unknown } | undefined)?.items);
        return { ...current, items: items.success ? items.data : [] };
      },
    },
  ),
);

export const selectCount = (s: CartState) => s.items.reduce((n, i) => n + i.qty, 0);
