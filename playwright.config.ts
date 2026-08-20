import { defineConfig, devices } from '@playwright/test';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321';
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.PUBLISHABLE_KEY ??
  process.env.ANON_KEY ??
  'sb_publishable_unauthenticated_e2e_placeholder';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 120_000,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
      VITE_APP_BASE_URL: 'http://127.0.0.1:4173/',
      VITE_BASE_PATH: '/',
      VITE_E2E_AUTH_SESSION: 'true',
    },
  },
  projects: [
    {
      name: 'chromium-auth-shell',
      testMatch: /auth-shell\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-auth-shell',
      testMatch: /auth-shell\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium-authenticated',
      testMatch: /authenticated\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
