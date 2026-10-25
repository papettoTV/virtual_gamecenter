import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './local-browser', testMatch: 'feedback.spec.mjs',
  timeout: 20000, workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'chrome', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
