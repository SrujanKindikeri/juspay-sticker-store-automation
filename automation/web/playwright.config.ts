import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from root .env if available
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isHeaded = process.env.HEADED === '1' || process.argv.includes('--headed');

export default defineConfig({
  testDir: './tests',
  timeout: isHeaded ? 90_000 : 60_000,
  expect: {
    timeout: isHeaded ? 15_000 : 10_000,
  },
  fullyParallel: false,
  workers: 1, // Single worker avoids database record collisions across isolated flows
  forbidOnly: !!process.env.CI,
  retries: 0, // Strict requirement: Exactly one execution per workflow, zero retries
  reporter: [
    ['list'],
    ['html', { outputFolder: path.resolve(__dirname, 'playwright-report'), open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    headless: !isHeaded,
    launchOptions: {
      slowMo: isHeaded ? (process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : 800) : 0,
    },
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: isHeaded ? 20_000 : 10_000,
    navigationTimeout: isHeaded ? 25_000 : 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 850 },
      },
    },
  ],
  outputDir: 'test-results',
});
