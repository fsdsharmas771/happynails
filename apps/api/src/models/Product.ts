import { NAIL_FINISHES, NAIL_SHAPES, OCCASIONS, type PublicProduct } from "@happynails/shared";
import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const HEX = /^#[0-9a-fA-F]{6}$/;

const productSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    shape: { type: String, required: true, enum: NAIL_SHAPES },
    finish: { type: String, required: true, enum: NAIL_FINISHES },
    occasion: { type: String, required: true, enum: OCCASIONS },
    color: { type: String, required: true, match: HEX },
    color2: { type: String, match: HEX },
    /** Integer paise. */
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: "pricePaise must be an integer" },
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: "stock must be an integer" },
    },
    images: {
      type: [{ _id: false, url: { type: String, required: true }, alt: { type: String, default: "" } }],
      default: [],
    },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

productSchema.index({ active: 1, sortOrder: 1 });

export type ProductAttrs = InferSchemaType<typeof productSchema>;
export type ProductDoc = HydratedDocument<ProductAttrs>;

export const Product = model("Product", productSchema);

/** The fields the storefront view needs; accepts hydrated and lean documents alike. */
type PublicSource = Omit<ProductAttrs, "images" | "active" | "sortOrder" | "createdAt" | "updatedAt"> & {
  images: ReadonlyArray<{ url: string; alt?: string | null }>;
};

export function toPublicProduct(p: PublicSource): PublicProduct {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    shape: p.shape,
    finish: p.finish,
    occasion: p.occasion,
    color: p.color,
    ...(p.color2 ? { color2: p.color2 } : {}),
    pricePaise: p.pricePaise,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? "" })),
    inStock: p.stock > 0,
  };
}
