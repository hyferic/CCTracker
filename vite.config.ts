import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const repository = env.GITHUB_REPOSITORY?.split('/')[1];
  const base = env.VITE_BASE_PATH ?? (repository ? `/${repository}/` : '/');
  const configuredSupabaseUrl = env.VITE_SUPABASE_URL?.trim();
  let supabaseConnectSources = 'https://*.supabase.co wss://*.supabase.co';
  if (configuredSupabaseUrl) {
    const supabaseUrl = new URL(configuredSupabaseUrl);
    const websocketProtocol = supabaseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    supabaseConnectSources = `${supabaseUrl.origin} ${websocketProtocol}//${supabaseUrl.host}`;
  }

  return {
    base,
    plugins: [
      react(),
      {
        name: 'exact-supabase-csp-origin',
        transformIndexHtml(html) {
          return html.replace('__SUPABASE_CONNECT_SRC__', supabaseConnectSources);
        },
      },
    ],
    build: {
      sourcemap: true,
      target: 'es2022',
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'supabase/**', 'node_modules/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/domain/**/*.ts'],
        thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
      },
    },
  };
});
