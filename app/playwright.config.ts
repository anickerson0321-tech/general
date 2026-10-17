import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixtures = fileURLToPath(new URL('./e2e/fixtures/', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    viewport: { width: 1280, height: 860 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fixtures}singer.wav`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    permissions: ['microphone'],
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
  },
})
