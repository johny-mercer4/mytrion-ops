/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only backend origin (production is same-origin: base '' → relative '/v1/*'). */
  readonly VITE_API_URL?: string;
  /** Dev-only API key for a cross-origin dev backend (production sends no key — same-origin). */
  readonly VITE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
