import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Control/query API and media gateway during dev.
      "/v1": "http://localhost:8000",
      "/media": "http://localhost:8090",
    },
  },
});
