/**
 * Zoho OAuth for the metadata analyzers — re-exports the shared primitives from the app's
 * integration layer so there is a single source of truth (see src/integrations/zoho.ts).
 * Analyzers are one-shot, so they call fetchZohoAccessToken directly (no caching); the app
 * uses the cached `wrapper` instead.
 */
export {
  fetchZohoAccessToken,
  resolveZohoConfig,
  zohoAuthHeader,
  type ZohoService,
  type ZohoServiceConfig,
  type ZohoToken,
} from '../../src/integrations/zoho.js';
