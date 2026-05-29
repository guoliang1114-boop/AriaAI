import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Read version from package.json
import { readFileSync } from 'fs'
import { resolve } from 'path'
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Conservative chunking: only carve out a small ``react-vendor``
        // for the React runtime that every page needs. Everything else
        // is left to Rollup's automatic chunking so heavy deps end up
        // *inside* the route bundle that actually uses them — e.g.
        // ``react-markdown`` rides with Chat, not as a preloaded
        // top-level chunk.
        //
        // The earlier setup carved 6 named vendor chunks (react /
        // markdown / i18n / ui / network / catch-all). Vite emits a
        // ``<link rel="modulepreload">`` for every chunk in the entry
        // import graph, so even visiting ``/workspace`` made the
        // browser race to download 7+ vendor files in parallel. On
        // slower connections that produced ~12s DOMContentLoaded for
        // a 250 kB total transfer because the chunks were tiny but
        // each request paid the same round-trip cost.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/') ||
            id.includes('/react-helmet-async/')
          ) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
