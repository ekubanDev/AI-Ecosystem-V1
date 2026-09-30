import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API is proxied so the browser sees one origin: the HttpOnly refresh cookie works without CORS or SameSite=None.
// Port 3000 matches the backend's default CLIENT_URL (used for the refresh-endpoint Origin check and email links).
const api = { "/api": { target: process.env.API_URL ?? "http://localhost:3001", changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, proxy: api },
  preview: { port: 3000, proxy: api },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.js"], globals: true },
});
