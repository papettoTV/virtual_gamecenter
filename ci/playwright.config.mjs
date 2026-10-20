import { defineConfig, devices } from '@playwright/test';
import { checkTarget } from './check-revision.mjs';
const environment = process.env.PULBASE_BROWSER_ENVIRONMENT;
const baseURL = checkTarget(environment, process.env.PULBASE_EXPECTED_SHA, process.env.PULBASE_CONFIRM_PRODUCTION === 'true');
const username = process.env.PULBASE_CHECK_USERNAME;
const password = process.env.PULBASE_CHECK_PASSWORD;
if ((username || password) && !(username && password)) throw Error('Incomplete browser credentials');
export default defineConfig({
  testDir: './browser', timeout: 30000, retries: 0, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'results/browser.json' }]],
  use: { baseURL, httpCredentials: username ? { username, password } : undefined,
    screenshot: 'on', trace: 'off', video: 'off' }, // Traces may contain authentication headers: never upload them.
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }],
});
