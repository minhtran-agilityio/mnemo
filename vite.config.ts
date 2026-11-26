import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Vite serves and builds the web UI that lives in ui/; Tauri loads the result.
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // The jsdom suites build whole screens; with every test file running at once
  // a slow one passes in 2s alone but can pass 5s, so allow more headroom.
  test: {
    testTimeout: 30_000,
    // The catalog screen test draws the whole UI Catalog in every test, in one run, with no pause
    // for the garbage collector to free the test DOM (happy-dom keeps nodes its selector queries
    // reached until the running job ends). That run holds about 2.2 GB, and Node's default heap
    // limit on a 7 GB CI machine is about 2 GB, so the worker aborted (SIGABRT, "heap limit").
    execArgv: ["--max-old-space-size=4096"],
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
