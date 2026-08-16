import { defineConfig } from '@playwright/test'
import { R1_VIEWPORT } from './r1.config.mjs'

/**
 * Device-sim smoke suite: Chromium at the R1's exact viewport with the device's
 * JS bridge (creationStorage, closeWebView) mocked, driving the app through
 * R1 hardware events. Backstop for everything the static scan cannot see
 * (runtime behavior, layout overflow, unhandled errors).
 */
export default defineConfig({
  testDir: './smoke',
  outputDir: './test-results',
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: R1_VIEWPORT.width, height: R1_VIEWPORT.height },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  webServer: {
    command: 'node scripts/serve-r1-dist.mjs 4173',
    url: 'http://localhost:4173/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
})
