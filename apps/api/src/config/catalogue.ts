import type { SizingOption } from "@happynails/shared";

/**
 * Sizing choices offered on every set. The server owns these prices; the storefront only displays them.
 * Custom-fit fee confirmed by the owner (2026-10-04). PLACEHOLDER: the kit contents in the
 * descriptions are not confirmed yet.
 */
export const SIZING_OPTIONS: readonly SizingOption[] = [
  {
    key: "standard",
    label: "Standard kit",
    description: "24 nails in 12 sizes. Use the size finder to match yours.",
    pricePaise: 0,
  },
  {
    key: "custom",
    label: "Custom-fit",
    description: "Send your measurements on WhatsApp. We size it for you.",
    pricePaise: 30000,
  },
];
