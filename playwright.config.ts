import { defineConfig } from '@playwright/test';

const LOCAL_LIBS =
  '/tmp/pwlibs/usr/lib/aarch64-linux-gnu:/tmp/pwlibs/lib/aarch64-linux-gnu';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  use: {
    headless: true,
    launchOptions: {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, LOCAL_LIBS].filter(Boolean).join(':'),
      },
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
