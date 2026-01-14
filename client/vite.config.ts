import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 5173,
    hmr: {
      overlay: true
    },
    proxy: {
      "/nostr-build": {
        target: "https://nostr.build",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/nostr-build/, "")
      }
    }
  }
});
