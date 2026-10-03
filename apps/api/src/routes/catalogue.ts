import {
  deliveryEstimate,
  etaRequestSchema,
  slugSchema,
  type ProductDetailResponse,
  type ProductListResponse,
} from "@happynails/shared";
import { Router } from "express";
import { SIZING_OPTIONS } from "../config/catalogue";
import { HttpError } from "../errors";
import { Product, toPublicProduct } from "../models/Product";

export function productsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const docs = await Product.find({ active: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    const body: ProductListResponse = {
      products: docs.map(toPublicProduct),
      sizingOptions: [...SIZING_OPTIONS],
    };
    res.json(body);
  });

  router.get("/:slug", async (req, res) => {
    const slug = slugSchema.safeParse(req.params.slug);
    const doc = slug.success ? await Product.findOne({ slug: slug.data, active: true }).lean() : null;
    if (!doc) throw new HttpError(404, "PRODUCT_NOT_FOUND", "No such set");
    const body: ProductDetailResponse = { product: toPublicProduct(doc), sizingOptions: [...SIZING_OPTIONS] };
    res.json(body);
  });

  return router;
}

export function shippingRouter(): Router {
  const router = Router();

  router.post("/eta", (req, res) => {
    const { pincode } = etaRequestSchema.parse(req.body);
    // The schema guarantees six digits, so an estimate always exists here.
    res.json(deliveryEstimate(pincode));
  });

  return router;
}
