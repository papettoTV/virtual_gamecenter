import {defineConfig,devices} from '@playwright/test';
if(process.env.PULBASE_BROWSER_ENVIRONMENT!=='staging'||!/^[a-f0-9]{40}$/.test(process.env.PULBASE_EXPECTED_SHA??''))throw Error('stagingの固定SHAだけを許可します');
const username=process.env.PULBASE_CHECK_USERNAME,password=process.env.PULBASE_CHECK_PASSWORD;
if((username||password)&&!(username&&password))throw Error('Basic認証が不完全です');
export default defineConfig({testDir:'./browser',timeout:30000,retries:0,workers:1,
 // JSON contains config credentials: capture in memory and retain only safe summary.
 reporter:'json',
 use:{baseURL:'https://develop.virtual-gamecenter.pages.dev',httpCredentials:username?{username,password,origin:'https://develop.virtual-gamecenter.pages.dev'}:undefined,
  serviceWorkers:'block',screenshot:'on',trace:'off',video:'off',launchOptions:{chromiumSandbox:true}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]});
