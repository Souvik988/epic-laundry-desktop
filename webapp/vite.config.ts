import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = fileURLToPath(new URL(".", import.meta.url))

// Epic BOS webapp — builds to ../server/public/app (served at /ui/app/ by the Fastify kernel,
// loaded by the Electron desktop app). base is relative-safe for offline file serving.
export default defineConfig({
  plugins: [react()],
  base: "/ui/app/",
  resolve: {
    alias: { "@": path.resolve(rootDir, "./src") },
  },
  build: {
    outDir: path.resolve(rootDir, "../server/public/app"),
    emptyOutDir: true,
    // Route-level lazy loading keeps the counter workspace fast; split shared
    // foundations explicitly so a chart-heavy or reporting screen does not
    // inflate the first dashboard download.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined
          if (id.includes("node_modules\\recharts") || id.includes("node_modules/recharts")) return "charts"
          if (id.includes("node_modules\\lucide-react") || id.includes("node_modules/lucide-react")) return "icons"
          if (id.includes("node_modules\\@tanstack\\react-query") || id.includes("node_modules/@tanstack/react-query")) return "query"
          if (
            id.includes("node_modules\\react\\") || id.includes("node_modules/react/") ||
            id.includes("node_modules\\react-dom\\") || id.includes("node_modules/react-dom/") ||
            id.includes("node_modules\\react-router") || id.includes("node_modules/react-router")
          ) return "react"
          return undefined
        },
      },
    },
  },
  server: { port: 5199 },
})
