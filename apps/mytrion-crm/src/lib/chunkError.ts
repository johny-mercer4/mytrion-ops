/**
 * A lazy `import()` (route-level code-split, or an on-demand vendor chunk like exceljs) fails with
 * this shape when the app was rebuilt/redeployed while the tab stayed open: the hashed filename the
 * already-loaded page references no longer exists on the server (this repo's deploy replaces the
 * `app/assets/*` output outright on each rebuild, no old-version retention). Shared by
 * `ErrorBoundary.tsx` (render-time lazy routes) and any on-click dynamic import (Excel/report
 * exports) so both surfaces give the same "reload for the new version" guidance instead of a raw
 * fetch-failure string.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message)
  );
}

/** User-facing message for a failed dynamic import — chunk-load gets the reload prompt, anything
 *  else keeps the raw error text (still worth showing, just not worth telling them to reload). */
export function chunkErrorMessage(error: unknown, action: string): string {
  if (isChunkLoadError(error)) {
    return `${action} failed — this page was open before a newer version was deployed. Please reload the page and try again.`;
  }
  return `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
}
