import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` serves the app on :5173 and sends /api to the local API (deno task dev, :8787;
// API_URL=http://localhost:<port> for another one).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8787" } },
});
