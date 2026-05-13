import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Backend lives in autotag/api.py and runs on :8081 by default.
// During dev we proxy autotag + health endpoints to it so the frontend
// keeps using the same URLs whether it's running under Vite or being
// served directly by FastAPI.
const BACKEND = "http://localhost:8081";

export default defineConfig({
  plugins: [viteSingleFile()],

  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/autotag": BACKEND,
      "/health": BACKEND,
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    // vite-plugin-singlefile bumps inline limits + disables code splitting
    // itself; everything else here is just defensive.
    target: "es2022",
  },
});
