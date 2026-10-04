import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { THEME_BOOT_SCRIPT } from "@happynails/ui/theme-boot";

/** Applies the saved theme before first paint so there is no flash of the wrong one. */
function themeBoot(): Plugin {
  return {
    name: "happynails-theme-boot",
    transformIndexHtml: () => [{ tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  plugins: [react(), themeBoot()],
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
    },
  },
  preview: { port: 5173, strictPort: true },
});
