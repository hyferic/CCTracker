/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_APP_BASE_URL?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_E2E_AUTH_SESSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PERKLEDGER_E2E_SET_SESSION__?: (accessToken: string, refreshToken: string) => Promise<void>;
}
