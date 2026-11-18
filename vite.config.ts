import { defineConfig } from "vite";

// Vite serves and builds the web UI that lives in ui/; Tauri loads the result.
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
