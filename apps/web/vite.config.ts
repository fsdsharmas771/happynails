import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Docker Desktop bind mounts do not deliver file events, so poll inside containers.
    watch: process.env.WATCH_POLL === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000" },
    },
  },
  preview: { port: 5173, strictPort: true },
});
