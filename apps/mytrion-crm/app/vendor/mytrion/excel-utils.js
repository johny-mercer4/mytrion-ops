/* =====================================================
   Mytrion — Excel (.xlsx) export utilities
   Mirrors pdf-utils.js. Used by the Transactions Report automation
   so Sales Agents can download an Excel workbook as an alternative
   to the PDF.

   SheetJS (XLSX) is loaded LAZILY from CDN the first time an agent
   actually exports to Excel, so it never weighs down the initial
   widget load. Exposes window.MytrionExcelUtils.
   ===================================================== */
(function () {
  "use strict";

  const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  let _xlsxPromise = null;

  /* Resolve the SheetJS global, loading the script on first use. */
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxPromise) return _xlsxPromise;
    _xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = XLSX_CDN;
      s.async = true;
      s.onload = () => {
        if (window.XLSX) resolve(window.XLSX);
        else reject(new Error("The Excel library loaded but did not initialize."));
      };
      s.onerror = () => {
        _xlsxPromise = null; // allow a retry next click
        reject(new Error("Could not load the Excel library (network)."));
      };
      document.head.appendChild(s);
    });
    return _xlsxPromise;
  }

  const num2 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };

  /* Per-unit prices show 3 decimals in the reference report (e.g. 6.002). */
  const num3 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  };

  const maskCard = (num) => {
    const t = String(num == null ? "—" : num);
    if (t === "—" || t.length <= 4) return t;
    return "•••• " + t.slice(-4);
  };

  const pad2 = (n) => String(n).padStart(2, "0");

  /* Reference report uses ISO-style date + 24h time in separate columns
     (e.g. "2026-05-13" / "04:00"), so we split transactionDate that way. */
  const dateOnly = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 10);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  const timeOnly = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return "";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const safeFilePart = (s) => String(s == null ? "" : s).replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");

  /**
   * Build + download a Transactions workbook.
   * @param {Object} opts
   * @param {string|number} opts.carrierId
   * @param {string} opts.startDate  YYYY-MM-DD
   * @param {string} opts.endDate    YYYY-MM-DD
   * @param {Object} opts.summary    { totalTransactions, totalFundedAmount, totalDiscount, totalGallons, dateRange }
   * @param {Array}  opts.transactions  grouped tx [{ transactionDate, cardNumber, location, lineItems:[{category,quantity,ppu,retailPPU,amount,discAmount}], fundedTotal, discAmount, fuelQuantity }]
   */
  async function generateTransactionsExcel(opts) {
    const o = opts || {};
    const XLSX = await loadXLSX();

    const carrierId = o.carrierId != null ? String(o.carrierId) : "—";
    const transactions = Array.isArray(o.transactions) ? o.transactions : [];
    /* Data-shaping options from the Transactions Report modal. (Layout-only
       flags like page-break / grand-total-only don't apply to a flat sheet.) */
    const opt = o.options || {};
    const fullCard = !!opt.fullCardNumber;
    const showTime = opt.showTime !== false;       // default on
    const retailOnly = !!opt.retailOnly;
    const showDiscount = opt.showDiscount !== false; // default on
    const showDiscountDetail = !!opt.showDiscountDetail;
    const addDataCaptureFee = !!opt.addDataCaptureFee;

    const wb = XLSX.utils.book_new();

    /* ── Transactions sheet (one row per line item) ─
       Column order/names mirror the classic WEX Transaction Report export,
       now including Driver Name / Driver ID / Unit # (from the mart) and the
       "SCLE" quantity-unit label (per C-15 spec). Card numbers are masked
       unless "Show entire card number" is on. */
    const header = [
      "Card #", "Driver Name", "Driver ID", "Unit #",
      "Tran Date", "Tran Time", "Location Name", "State/Prov",
      "Item", "Unit Price", "Retail/Unit", "SCLE", "Amount (USD)",
    ];
    if (showDiscount) header.push("Discount (USD)");
    if (showDiscountDetail) header.push("Disc/Unit", "Discount Type");
    if (addDataCaptureFee) header.push("Data Capture Fee (USD)");
    header.push("Currency");
    const rows = [header];
    let totQty = 0, totAmt = 0, totDisc = 0, totFee = 0;
    const seenFeeTx = new Set();

    transactions.forEach((tx) => {
      const card = fullCard ? String(tx.cardNumber || "—") : maskCard(tx.cardNumber);
      const tranDate = dateOnly(tx.transactionDate);
      const tranTime = showTime ? timeOnly(tx.transactionDate) : "";
      const locationName = tx.locationName || tx.location || "—";
      const state = tx.locationState || "";
      const feeForTx = !seenFeeTx.has(tx.id) ? (Number(tx.carrierFee) || 0) : 0;
      seenFeeTx.add(tx.id);
      if (feeForTx) totFee += feeForTx;
      const items = Array.isArray(tx.lineItems) && tx.lineItems.length
        ? tx.lineItems
        : [{ category: "—", quantity: tx.fuelQuantity, ppu: null, retailPPU: null, amount: tx.fundedTotal, discAmount: tx.discAmount, discPerUnit: null, discType: "" }];
      items.forEach((li, liIdx) => {
        const qty = num2(li.quantity);
        const amt = num2(li.amount);
        const disc = num2(li.discAmount);
        if (qty) totQty += qty;
        if (amt) totAmt += amt;
        if (disc) totDisc += disc;
        const unitPrice = retailOnly ? num3(li.retailPPU) : num3(li.ppu);
        const row = [
          card, tx.driverName || "", tx.driverId || "", tx.unitNumber || "",
          tranDate, tranTime, locationName, state,
          li.category || "—", unitPrice, num3(li.retailPPU), qty, amt,
        ];
        if (showDiscount) row.push(disc);
        if (showDiscountDetail) { row.push(num3(li.discPerUnit)); row.push(li.discType || ""); }
        if (addDataCaptureFee) row.push(liIdx === 0 && feeForTx ? num2(feeForTx) : "");
        row.push("USD");
        rows.push(row);
      });
    });

    /* Totals row — aligned under SCLE / Amount / Discount (+ fee). */
    const totalRow = ["", "", "", "", "", "", "", "", "TOTAL", "", "", num2(totQty), num2(totAmt)];
    if (showDiscount) totalRow.push(num2(totDisc));
    if (showDiscountDetail) totalRow.push("", "");
    if (addDataCaptureFee) totalRow.push(num2(totFee));
    totalRow.push("");
    rows.push([]);
    rows.push(totalRow);

    const txWs = XLSX.utils.aoa_to_sheet(rows);
    const cols = [
      { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
      { wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 10 },
      { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 14 },
    ];
    if (showDiscount) cols.push({ wch: 14 });
    if (showDiscountDetail) cols.push({ wch: 10 }, { wch: 26 });
    if (addDataCaptureFee) cols.push({ wch: 18 });
    cols.push({ wch: 13 });
    txWs["!cols"] = cols;
    txWs["!freeze"] = { xSplit: 0, ySplit: 1 }; // freeze header row (honored by some readers)
    XLSX.utils.book_append_sheet(wb, txWs, "Transactions");

    const filename = `transactions_${safeFilePart(carrierId)}_${safeFilePart(o.startDate)}_${safeFilePart(o.endDate)}.xlsx`;
    /* Deliver via the mobile-aware helper when present (opens in a new tab
       inside the Zoho mobile app's WebView, where XLSX.writeFile — an
       anchor-download under the hood — silently fails). Desktop / missing
       helper fall back to the native writer. */
    if (window.MytrionDownload && typeof window.MytrionDownload.deliverBlob === "function") {
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      window.MytrionDownload.deliverBlob(blob, filename);
    } else {
      XLSX.writeFile(wb, filename);
    }
  }

  /* Generic array-of-arrays → XLSX writer. Lets callers build any sheet shape
       (e.g. the EFS Transaction Report: per-group detail + group totals + grand
       totals) and hand it over for delivery. `colWidths` is optional. */
  async function aoaToXlsx(aoa, filename, colWidths) {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(Array.isArray(aoa) ? aoa : []);
    if (Array.isArray(colWidths)) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    const name = filename || "transactions.xlsx";
    if (window.MytrionDownload && typeof window.MytrionDownload.deliverBlob === "function") {
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      window.MytrionDownload.deliverBlob(blob, name);
    } else {
      XLSX.writeFile(wb, name);
    }
  }

  window.MytrionExcelUtils = { generateTransactionsExcel, aoaToXlsx, loadXLSX };
})();
