import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Vite serves and builds the web UI that lives in ui/; Tauri loads the result.
export default defineConfig({
  root: "ui",
  clearScreen: false,
  test: {
    // The full suite runs 80+ files in parallel; DOM-heavy screens can pass the 5 s default under that load.
    testTimeout: 20000,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Two pages: the app, and the startup error page the core opens when storage fails.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "ui/index.html"),
        error: resolve(import.meta.dirname, "ui/error.html"),
      },
    },
  },
});
