/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only backend URL (production reads MYTRION_OPS_API_URL from a Zoho org variable). */
  readonly VITE_API_URL?: string;
  /** Dev-only API key (production injects it server-side via the Zoho HTTP proxy). */
  readonly VITE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
