/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only backend origin (production is same-origin: base '' → relative '/v1/*'). */
  readonly VITE_API_URL?: string;
  /** Dev-only API key for a cross-origin dev backend (production sends no key — same-origin). */
  readonly VITE_API_KEY?: string;
  /** Dev-only: set to '1' to bypass Zoho sign-in with a mock admin (uses the API key, no session). */
  readonly VITE_DEV_MOCK_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
