import { z } from "zod";
import { hexColorSchema, nailFinishSchema, nailShapeSchema } from "./nail";

export const OCCASIONS = ["everyday", "party", "bridal"] as const;
export const occasionSchema = z.enum(OCCASIONS);
export type Occasion = z.infer<typeof occasionSchema>;

export const OCCASION_LABELS: Record<Occasion, string> = {
  everyday: "Everyday",
  party: "Party",
  bridal: "Bridal",
};

export const slugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase slug like rose-chrome");

/** How a set is sized: the standard multi-size kit, or made to the customer's measurements. */
export const SIZING_OPTION_KEYS = ["standard", "custom"] as const;
export const sizingOptionKeySchema = z.enum(SIZING_OPTION_KEYS);
export type SizingOptionKey = z.infer<typeof sizingOptionKeySchema>;

const paiseSchema = z.number().int().nonnegative();

export const sizingOptionSchema = z.object({
  key: sizingOptionKeySchema,
  label: z.string(),
  description: z.string(),
  /** Added to the set's price, per set. */
  pricePaise: paiseSchema,
});
export type SizingOption = z.infer<typeof sizingOptionSchema>;

export const productImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string(),
});

/** What the storefront sees. Stock counts stay on the server; only availability is exposed. */
export const publicProductSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  shape: nailShapeSchema,
  finish: nailFinishSchema,
  occasion: occasionSchema,
  color: hexColorSchema,
  color2: hexColorSchema.optional(),
  pricePaise: paiseSchema,
  images: z.array(productImageSchema),
  inStock: z.boolean(),
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const productListResponseSchema = z.object({
  products: z.array(publicProductSchema),
  sizingOptions: z.array(sizingOptionSchema),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const productDetailResponseSchema = z.object({
  product: publicProductSchema,
  sizingOptions: z.array(sizingOptionSchema),
});
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;

export const MAX_QTY_PER_LINE = 9;

/** A line in the visitor's bag. Prices are never stored client-side; the server re-quotes. */
export const cartItemSchema = z.object({
  slug: slugSchema,
  option: sizingOptionKeySchema,
  qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
});
export type CartItem = z.infer<typeof cartItemSchema>;
