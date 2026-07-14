/* =====================================================
   Mytrion — file download helper
   Exposes window.MytrionDownload.

   WHY: PDF (jsPDF) / Excel (SheetJS) / invoice downloads all rely on a
   Blob + <a download>.click(). That works on desktop browsers, but inside
   the Zoho CRM MOBILE app's WebView the anchor-download is a no-op and the
   file shows as a broken box. The fix: on mobile/WebView, open the file in a
   new tab so the OS viewer can display/save/share it; keep the native
   download on desktop.

   NOTE: the new-tab fallback is best-effort and MUST be verified on a real
   device — mobile WebView behaviour can't be reproduced on a dev machine.
   ===================================================== */
(function () {
  "use strict";

  /* Heuristic for "we're in a mobile WebView where anchor-downloads fail".
     We treat any mobile OS user-agent as such — desktop browsers keep the
     normal download path. Erring toward "mobile" only changes desktop to a
     new tab, never the reverse, so a false positive is harmless. */
  function isMobileWebView() {
    try {
      const ua = String(navigator.userAgent || navigator.vendor || "").toLowerCase();
      return /android|iphone|ipad|ipod|iemobile|blackberry|windows phone|mobile/.test(ua);
    } catch (_) {
      return false;
    }
  }

  /* Deliver a Blob to the user.
       desktop        → native <a download> click (file saved directly)
       mobile/WebView → convert to base64 data URL via FileReader, then open
                        in a new tab. Blob URLs (URL.createObjectURL) are
                        sandboxed to the originating context in Zoho's WebView
                        and cause a blank/broken page when opened cross-tab;
                        data URLs are self-contained and survive the tab hop. */
  function deliverBlob(blob, filename) {
    if (isMobileWebView()) {
      const reader = new FileReader();
      reader.onloadend = function () {
        const dataUrl = reader.result;
        const win = window.open(dataUrl, "_blank");
        if (!win) {
          /* Popup blocked — navigate in place as last resort. */
          try { window.location.href = dataUrl; } catch (_) { }
        }
      };
      reader.onerror = function () {
        /* FileReader unavailable — fall back to blob URL (may fail in WebView). */
        const objUrl = URL.createObjectURL(blob);
        const win = window.open(objUrl, "_blank");
        if (!win) {
          try { window.location.href = objUrl; } catch (_) { }
        }
        setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (_) { } }, 60000);
      };
      reader.readAsDataURL(blob);
      return;
    }

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (_) { } }, 5000);
  }

  window.MytrionDownload = { isMobileWebView, deliverBlob };
})();
