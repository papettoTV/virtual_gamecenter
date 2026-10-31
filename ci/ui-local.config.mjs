import {defineConfig,devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 testDir:'../apps/web/tests/ui',testMatch:'*.spec.mjs',timeout:30000,retries:0,workers:1,
 outputDir:'./ui-results/test-results',
 // Reporter paths are relative to this config directory; upload-artifact collects ci/ui-results.
 reporter:[['list'],['json',{outputFile:'ui-results/report.json'}],['html',{outputFolder:'ui-results/html',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:5174',httpCredentials:{username:'ci-example',password:'ci-example'},screenshot:'on',trace:'off',video:'off'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 webServer:{command:'npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5174 --strictPort',cwd:fileURLToPath(new URL('../',import.meta.url)),
  url:'http://127.0.0.1:5174',timeout:120000,reuseExistingServer:false,ignoreHTTPSErrors:false},
});
