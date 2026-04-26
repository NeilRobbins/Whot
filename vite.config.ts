import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same dist/ works at the site root (Cloudflare
  // Pages, Netlify) or under a sub-path (GitHub Pages /<repo>/).
  base: "./",
  resolve: {
    alias: {
      "@protocol-core": fileURLToPath(new URL("./src/packages/protocol-core", import.meta.url)),
      "@trust-core": fileURLToPath(new URL("./src/packages/trust-core", import.meta.url)),
      "@game-log": fileURLToPath(new URL("./src/packages/game-log", import.meta.url)),
      "@whot-rules": fileURLToPath(new URL("./src/packages/whot-rules", import.meta.url)),
      "@lobby": fileURLToPath(new URL("./src/packages/lobby", import.meta.url)),
      "@transport": fileURLToPath(new URL("./src/packages/transport", import.meta.url)),
      "@endgame": fileURLToPath(new URL("./src/packages/endgame", import.meta.url)),
      "@test-harness": fileURLToPath(new URL("./src/packages/test-harness", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
