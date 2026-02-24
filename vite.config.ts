import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    react({
      babel: {
        plugins:
          command === "serve"
            ? [
                // Inject data-source attribute for AI agent source location in dev only.
                "./scripts/babel-plugin-jsx-source-location.cjs",
              ]
            : [],
      },
    }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|wouter)\//.test(id)) return "vendor-react";
          if (id.includes("node_modules/framer-motion/")) return "vendor-motion";
          if (id.includes("node_modules/recharts/")) return "vendor-charts";
          return undefined;
        },
      },
    },
  },
}));
