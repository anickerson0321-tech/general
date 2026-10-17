import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works from any sub-path (e.g. GitHub Pages /general/).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
} as Parameters<typeof defineConfig>[0])
