import { Router } from "express";
import { Product } from "../models/Product";

const xmlEscape = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );

/**
 * robots.txt and sitemap.xml for the storefront. The sitemap needs absolute URLs, so it exists
 * only once PUBLIC_SITE_URL is set; until then robots.txt simply allows crawling.
 */
export function seoRouter(siteUrl: string | undefined): Router {
  const router = Router();
  const site = siteUrl?.replace(/\/$/, "");

  router.get("/robots.txt", (_req, res) => {
    const lines = ["User-agent: *", "Disallow: /checkout", "Disallow: /order/", "Allow: /"];
    if (site) lines.push(`Sitemap: ${site}/sitemap.xml`);
    res.type("text/plain").send(`${lines.join("\n")}\n`);
  });

  router.get("/sitemap.xml", async (_req, res) => {
    if (!site) {
      res.status(404).type("text/plain").send("Sitemap unavailable: PUBLIC_SITE_URL is not set\n");
      return;
    }
    const products = await Product.find({ active: true })
      .sort({ sortOrder: 1 })
      .select({ slug: 1, updatedAt: 1 })
      .lean();
    const urls = [
      `<url><loc>${xmlEscape(`${site}/`)}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
      ...products.map(
        (p) =>
          `<url><loc>${xmlEscape(`${site}/?set=${p.slug}`)}</loc><lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`,
      ),
    ];
    res
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      );
  });

  return router;
}
