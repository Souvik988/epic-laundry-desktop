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
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5199 },
})
