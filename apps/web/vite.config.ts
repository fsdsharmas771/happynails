import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { themeBootPlugin } from "@happynails/ui/theme-boot";

/**
 * Canonical URL, og:url and structured data need the site's public address, which is not
 * decided yet (PUBLIC_SITE_URL). Without it these tags are simply left out rather than guessed.
 */
function seoTags(): Plugin {
  const site = process.env.PUBLIC_SITE_URL?.replace(/\/$/, "");
  return {
    name: "happynails-seo",
    transformIndexHtml: () => {
      if (!site) return [];
      const org = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Happy Nails by Anamika",
        url: site,
        areaServed: ["Delhi", "Noida", "Gurgaon", "India"],
      };
      return [
        { tag: "link", attrs: { rel: "canonical", href: `${site}/` }, injectTo: "head" },
        { tag: "meta", attrs: { property: "og:url", content: `${site}/` }, injectTo: "head" },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          children: JSON.stringify(org),
          injectTo: "head",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), themeBootPlugin(), seoTags()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Compose service name, so other containers (screenshots, Playwright) can reach the dev server.
    allowedHosts: ["web"],
    // Docker Desktop bind mounts do not deliver file events, so poll inside containers.
    watch: process.env.WATCH_POLL === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
      "/uploads": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
      "/robots.txt": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
      "/sitemap.xml": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
    },
  },
  preview: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely: separate files keep them cached across site updates.
        manualChunks: {
          react: ["react", "react-dom"],
          data: ["@tanstack/react-query", "react-router", "zustand"],
          zod: ["zod"],
        },
      },
    },
  },
});
