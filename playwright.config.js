import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 30000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:5173', headless: true,
    launchOptions: process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: 'chrome'}},
  webServer: {command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true},
});
