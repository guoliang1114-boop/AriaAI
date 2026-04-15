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

          if (
            id.includes('/react-markdown/') ||
            id.includes('/remark-gfm/')
          ) {
            return 'markdown-vendor'
          }

          if (
            id.includes('/i18next/') ||
            id.includes('/react-i18next/')
          ) {
            return 'i18n-vendor'
          }

          if (
            id.includes('/@dnd-kit/') ||
            id.includes('/lucide-react/')
          ) {
            return 'ui-vendor'
          }

          if (id.includes('/axios/')) {
            return 'network-vendor'
          }

          return 'vendor'
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
