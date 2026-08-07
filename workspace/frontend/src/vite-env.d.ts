/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_MOCKING?: 'true' | 'false';
  readonly VITE_MOCK_SCENARIO?: string;
  readonly VITE_SHOW_DEVELOPER_TOOLS?: 'true' | 'false';
  // The active store's UUID. Falls back to the mock fixture's UUID when unset, so mocked
  // development keeps working without configuration; local mock-off and real-backend runs
  // must set this explicitly since no store-discovery API exists yet.
  readonly VITE_STORE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
