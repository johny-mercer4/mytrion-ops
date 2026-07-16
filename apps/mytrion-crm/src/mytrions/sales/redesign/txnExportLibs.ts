/**
 * Lazy-load the same client export stack the self-service widget uses
 * (jsPDF + MytrionPdfUtils / MytrionExcelUtils / MytrionDownload).
 */
declare global {
  interface Window {
    jspdf?: { jsPDF: new (...args: unknown[]) => unknown };
    jsPDF?: new (...args: unknown[]) => unknown;
    MytrionPdfUtils?: {
      generateTransactionsPdf: (opts: Record<string, unknown>) => Promise<void>;
    };
    MytrionExcelUtils?: {
      aoaToXlsx: (aoa: unknown[][], filename: string, colWidths?: number[]) => Promise<void>;
      generateTransactionsExcel: (opts: Record<string, unknown>) => Promise<void>;
      loadXLSX: () => Promise<unknown>;
    };
    MytrionDownload?: {
      deliverBlob: (blob: Blob, filename: string) => void;
      isMobileWebView: () => boolean;
    };
  }
}

let loadPromise: Promise<void> | null = null;

function injectScript(src: string, id: string): Promise<void> {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Ensure jsPDF + Mytrion PDF/Excel/Download helpers are on window. */
export async function ensureTxnExportLibs(): Promise<void> {
  if (window.MytrionPdfUtils && window.MytrionExcelUtils && window.MytrionDownload) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const base = `${import.meta.env.BASE_URL || '/'}vendor/mytrion`;
      if (!window.jspdf?.jsPDF && !window.jsPDF) {
        // Vendored (public/vendor/mytrion, sourced from the jspdf@2.5.1 devDependency) like
        // the other helpers — no runtime CDN dependency, works offline/behind CSP.
        await injectScript(`${base}/jspdf.umd.min.js`, 'mytrion-jspdf');
      }
      await injectScript(`${base}/download-utils.js`, 'mytrion-download-utils');
      await injectScript(`${base}/pdf-utils.js`, 'mytrion-pdf-utils');
      await injectScript(`${base}/excel-utils.js`, 'mytrion-excel-utils');
      if (!window.MytrionPdfUtils || !window.MytrionExcelUtils || !window.MytrionDownload) {
        throw new Error('Transaction export libraries failed to initialize.');
      }
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

export function deliverBlob(blob: Blob, filename: string): void {
  if (window.MytrionDownload?.deliverBlob) {
    window.MytrionDownload.deliverBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
