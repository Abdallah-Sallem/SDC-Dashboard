import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@core':     fileURLToPath(new URL('src/core',     import.meta.url)),
      '@ui':       fileURLToPath(new URL('src/ui',       import.meta.url)),
      '@security': fileURLToPath(new URL('src/security', import.meta.url)),
      '@storage':  fileURLToPath(new URL('src/storage',  import.meta.url)),
      '@shared':   fileURLToPath(new URL('src/shared',   import.meta.url)),
    }
  },

  build: {
    target: 'es2020',
  }
})