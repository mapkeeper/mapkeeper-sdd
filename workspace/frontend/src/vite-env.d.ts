/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_MOCKING?: 'true' | 'false';
  readonly VITE_MOCK_SCENARIO?: string;
  readonly VITE_STORE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
