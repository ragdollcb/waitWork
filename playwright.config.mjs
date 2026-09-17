import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:5191', reuseExistingServer: false },
    { command: 'npm run dev', env: { WAITWORK_DATA_DIR: resolve('test-results', `cli-data-${Date.now()}`) }, url: 'http://127.0.0.1:5190', reuseExistingServer: false, timeout: 90000 },
  ],
});
