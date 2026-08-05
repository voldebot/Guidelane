import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const artifactDirectory = process.env.COCKPIT_ARTIFACTS ?? join(tmpdir(), 'guidelane-cockpit-playwright')

export default defineConfig({
  testDir: './e2e',
  outputDir: artifactDirectory,
  reporter: [['list'], ['json', { outputFile: join(artifactDirectory, 'playwright-report.json') }]],
  fullyParallel: false,
  forbidOnly: true,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium-1280x800', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'chromium-1024x768', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'webkit-1280x800', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-1024x768', use: { ...devices['Desktop Safari'], viewport: { width: 1024, height: 768 } } },
  ],
})
