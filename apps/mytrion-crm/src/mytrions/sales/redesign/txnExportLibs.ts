/**
 * Lazy-load the PDF helper stack the self-service widget uses. Excel is generated with the
 * application-bundled ExcelJS module; CSV/Text need no runtime libraries.
 */
declare global {
  interface Window {
    jspdf?: { jsPDF: typeof import('jspdf').jsPDF };
    jsPDF?: typeof import('jspdf').jsPDF;
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

let pdfLoadPromise: Promise<void> | null = null;

function injectScript(src: string, id: string): Promise<void> {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(s);
  });
}

async function injectAsset(file: string, id: string): Promise<void> {
  // `base: './'` is correct for the Zoho bundle but resolves below a deep SPA URL in local/dev.
  // Try the bundle-relative asset first and the dev-server root second.
  const relative = `${import.meta.env.BASE_URL || '/'}vendor/mytrion/${file}`;
  const candidates = [...new Set([relative, `/vendor/mytrion/${file}`])];
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    try {
      await injectScript(candidates[i]!, `${id}-${i}`);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load ${file}`);
}

/** Ensure bundled jsPDF plus the Mytrion PDF helper are ready. */
export async function ensureTxnPdfLibs(): Promise<void> {
  if (window.MytrionPdfUtils && window.MytrionDownload) return;
  if (!pdfLoadPromise) {
    pdfLoadPromise = (async () => {
      if (!window.jspdf?.jsPDF) {
        const { jsPDF } = await import('jspdf');
        window.jspdf = { jsPDF };
        window.jsPDF = jsPDF;
      }
      await injectAsset('download-utils.js', 'mytrion-download-utils');
      await injectAsset('pdf-utils.js', 'mytrion-pdf-utils');
      if (!window.MytrionPdfUtils || !window.MytrionDownload) {
        throw new Error('Transaction PDF support failed to initialize.');
      }
    })().catch((err) => {
      pdfLoadPromise = null;
      throw err;
    });
  }
  await pdfLoadPromise;
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
