import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { themeBootPlugin } from "@happynails/ui/theme-boot";

export default defineConfig({
  plugins: [react(), themeBootPlugin()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    // Compose service name, so other containers (screenshots, Playwright) can reach the dev server.
    allowedHosts: ["admin"],
    // Docker Desktop bind mounts do not deliver file events, so poll inside containers.
    watch: process.env.WATCH_POLL === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
      "/uploads": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
    },
  },
  preview: { port: 5174, strictPort: true },
});
