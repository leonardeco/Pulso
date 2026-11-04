import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npx tsx --env-file=.env scripts/servidor-local.ts',
    url: 'http://127.0.0.1:4300/api/sesion',
    reuseExistingServer: false,
    env: { PULSO_E2E: '1' },
    timeout: 300000,
  },
});
