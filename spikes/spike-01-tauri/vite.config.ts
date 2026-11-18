import { defineConfig } from "vite";

// Throwaway spike: Vite serves and builds the page that Tauri loads.
export default defineConfig({
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
