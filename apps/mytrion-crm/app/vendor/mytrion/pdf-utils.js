/* ==========================================================
   Mytrion PDF Utilities
   ──────────────────────────────────────────────────────────
   Framework-agnostic PDF helpers built on jsPDF (UMD).
   Requires window.jspdf.jsPDF to be loaded before use.

   Usage:
     MytrionPdfUtils.generateTransactionsPdf({
       carrierId,
       startDate,
       endDate,
       summary,    // { totalTransactions, totalAmount, totalProducts, dateRange }
       ai,         // { totalGallons }
       transactions, // array — see shape below
     });

   Transaction shape:
     { name, transactionId, amount, transactionDate,
       location, item, cardNumber,
       products: [{ name, quantity, pricePerUnit, lineItemTotal }] }
========================================================== */
window.MytrionPdfUtils = (function () {

    /* ── Image loader (cached, downscaled + re-encoded) ──────────
       jsPDF embeds whatever pixel buffer you hand it — and when the source
       is a 2000×1330 PNG (our Octane mark), the resulting PDF carries the
       full uncompressed RGBA stream and balloons to ~10MB. We resample to
       a max ~320px on the longest edge (more than enough for the 16mm
       header block) and re-encode as JPEG quality 0.88, which lands the
       embedded asset around ~12KB. Output PDF drops back to <500KB.

       JPEG is safe here: the logo always sits on a solid white card, so
       PNG transparency isn't needed.

       Returns { dataUrl, format, w, h } — `format` is what to pass as the
       second arg to doc.addImage (always "JPEG" after downscale). */
    const _imageCache = Object.create(null);

    function _loadPng(url) {
        if (_imageCache[url]) return _imageCache[url];
        _imageCache[url] = (async () => {
            const resp = await fetch(url, { cache: "force-cache" });
            if (!resp.ok) throw new Error(`Failed to load ${url}: HTTP ${resp.status}`);
            const blob = await resp.blob();
            const rawDataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onloadend = () => resolve(r.result);
                r.onerror   = reject;
                r.readAsDataURL(blob);
            });

            const img = await new Promise((resolve, reject) => {
                const im = new Image();
                im.onload  = () => resolve(im);
                im.onerror = reject;
                im.src     = rawDataUrl;
            });
            const srcW = img.naturalWidth  || 1;
            const srcH = img.naturalHeight || 1;

            /* Downscale + flatten onto white. Max 200px on the longest edge —
               the logo only ever renders at 16-20mm in the PDF header, so
               anything beyond ~200px is wasted bits. A 200px JPEG @ q0.82
               lands around 5-7KB embedded vs ~57KB for the source PNG. */
            const MAX_DIM = 200;
            const scale  = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
            const dstW   = Math.max(1, Math.round(srcW * scale));
            const dstH   = Math.max(1, Math.round(srcH * scale));

            const canvas = document.createElement("canvas");
            canvas.width  = dstW;
            canvas.height = dstH;
            const ctx = canvas.getContext("2d");
            /* Flatten onto white so the JPEG (no alpha) matches the white
               block in the PDF header without a tinted edge from transparent
               PNG pixels. */
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, dstW, dstH);
            ctx.drawImage(img, 0, 0, dstW, dstH);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

            return { dataUrl, format: "JPEG", w: dstW, h: dstH };
        })().catch(err => {
            /* Don't poison the cache on failure — drop the rejected promise
               so a later call (e.g. after the asset URL is fixed) can retry. */
            delete _imageCache[url];
            throw err;
        });
        return _imageCache[url];
    }

    // ── Standalone formatters ─────────────────────────────────
    function fmtCurrency(value) {
        const amount = Number(value);
        if (Number.isNaN(amount)) return "—";
        return amount.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function fmtDate(val) {
        if (!val) return "—";
        const s = String(val);
        // EFS prints ISO yyyy-MM-dd. If the value already starts with one, slice
        // it directly — avoids a timezone shift from parsing a date-only string.
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const d = new Date(val);
        if (isNaN(d)) return s;
        const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
        return `${y}-${mo}-${day}`;
    }

    // ── Core generator ────────────────────────────────────────
    /**
     * @param {object} opts
     * @param {string}   opts.carrierId
     * @param {string}   opts.startDate    – ISO / display string
     * @param {string}   opts.endDate
     * @param {object}   opts.summary      – { totalTransactions, totalFundedAmount, totalDiscount, totalGallons, dateRange }
     * @param {Array}    opts.transactions  – mapped transaction objects from AutomationModal
     * @param {string}  [opts.fileName]    – overrides auto-generated name
     * @param {string}  [opts.logoUrl]     – override logo path. Default is
     *                                       "../assets/octane.png" relative to
     *                                       the calling page (works for the
     *                                       self-service widget today).
     * @returns {Promise<void>}  – triggers browser download via doc.save()
     */
    async function generateTransactionsPdf(opts) {
        const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDFCtor) {
            throw new Error("jsPDF is not loaded. Add the jsPDF CDN script before pdf-utils.js.");
        }

        const {
            carrierId = "—",
            startDate = "",
            endDate = "",
            summary = {},
            transactions = [],
            logoUrl = "../assets/octane.png",
            options = {},
        } = opts;

        /* Report display options (from the Transactions Report modal). The
           incoming `transactions` are already filtered + sorted client-side;
           these flags only shape how the PDF renders them. */
        const {
            pageBreak = false,          // start each group on its own page
            removeDetails = false,      // hide per-transaction rows (keep group totals)
            grandTotalOnly = false,     // only the grand-total band
            removeGroupSummary = false, // hide the per-group summary footer
            fullCardNumber = false,     // show the entire card number (vs masked)
            showTime = false,           // append the transaction time to Tran Date
            retailOnly = false,         // show only retail Unit Price (hide discounted PPU)
            showDiscount = true,        // show the Disc Amt column
            showDiscountDetail = true,  // show the Disc PPU + Disc Cost columns
            addDataCaptureFee = true,   // include the Fees column + fee in totals
            groupBy = "card_number",    // card_number | driver | state_province
        } = options;
        const groupByState = groupBy === "state_province";
        const groupByDriver = groupBy === "driver";

        /* Preload the brand logo. Caller can opt out by passing
           logoUrl: null / "". On failure we log and continue without it —
           a PDF with a slightly bare header is still better than no PDF. */
        let logo = null;
        if (logoUrl) {
            try {
                logo = await _loadPng(logoUrl);
            } catch (e) {
                console.warn("[Mytrion PDF] Logo failed to load, generating without it:", e);
            }
        }

        // ── Card number — masked •••• XXXX, or full when fullCardNumber ──
        const maskCard = (num) => {
            const t = String(num || "—");
            if (fullCardNumber) return t;
            if (t === "—" || t.length <= 8) return t;
            const middle = t.length - 8;
            return t.slice(0, 4) + " " + "•".repeat(Math.min(middle, 8)) + " " + t.slice(-4);
        };

        /* ── Group transactions ────────────────────────────────
           Group by card number (default) or by state/province (IFTA). Card
           keys are digits-only so "7083 …" and "7083…" don't split. Within a
           group rows sort by date DESC. Card groups order by most-recent
           activity; state groups order alphabetically. */
        const _digits = (s) => String(s || "").replace(/\D/g, "");
        const cardGroups = [];
        const cardGroupMap = new Map();
        transactions.forEach(t => {
            const driverKey = String(t.driverId || "").trim() || String(t.driverName || "").trim() || "—";
            const key = groupByState
                ? (String(t.locationState || "").toUpperCase() || "—")
                : groupByDriver
                    ? driverKey
                    : (_digits(t.cardNumber) || String(t.cardNumber || "—"));
            if (!cardGroupMap.has(key)) {
                const driverLbl = [String(t.driverName || "").trim(), t.driverId && `#${t.driverId}`].filter(Boolean).join(" ") || "—";
                const g = {
                    key,
                    groupByState,
                    groupByDriver,
                    cardNumber: t.cardNumber || "—",
                    state: String(t.locationState || "").toUpperCase() || "—",
                    driverLabel: driverLbl,
                    transactions: [],
                };
                cardGroupMap.set(key, g);
                cardGroups.push(g);
            }
            cardGroupMap.get(key).transactions.push(t);
        });
        const _ts = (t) => {
            if (t?.transactionTimeMs) return Number(t.transactionTimeMs);
            const d = t?.transactionDate ? new Date(t.transactionDate).getTime() : 0;
            return Number.isFinite(d) ? d : 0;
        };
        cardGroups.forEach(g => g.transactions.sort((a, b) => _ts(b) - _ts(a)));
        if (groupByState || groupByDriver) {
            cardGroups.sort((a, b) => String(a.key).localeCompare(String(b.key)));
        } else {
            cardGroups.sort((a, b) => _ts(b.transactions[0]) - _ts(a.transactions[0]));
        }

        // ── Brand colours ─────────────────────────────────────────
        // Theme switched from burnt-orange to a professional blue set
        // (Tailwind blue scale). The constant names keep the C_ORANGE_*
        // shape so the ~12 usage sites below didn't have to be renamed —
        // read them as "the primary theme colour", not literally orange.
        //
        //   #ea580c (orange-600) → #2563eb (blue-600 — primary brand)
        //   #ffedd5 (orange-100) → #dbeafe (blue-100 — wash / light text)
        //   #fdba74 (orange-300) → #93c5fd (blue-300 — outlines / dividers)
        //   #fff7ed (orange-50)  → #eff6ff (blue-50  — cover / stat bg)
        //   #fbbf24 (amber-400)  → #38bdf8 (sky-400  — header accent line)
        // Formal slate palette — a deep slate primary (header bands / grid
        // headers) with neutral slate tints and a restrained amber accent line.
        // Reads like a professional finance report rather than a bright-blue UI.
        const C_ORANGE = [30, 41, 59];         // #1e293b — primary (slate-800)
        const C_ORANGE_LITE = [241, 245, 249]; // #f1f5f9 — group band bg (slate-100)
        const C_ORANGE_MID = [203, 213, 225];  // #cbd5e1 — card outlines / dividers (slate-300)
        const C_ORANGE_TINT = [248, 250, 252]; // #f8fafc — cover / stat bg (slate-50)
        const C_YELLOW = [202, 138, 4];        // #ca8a04 — header accent line (amber-700)
        const C_DARK = [15, 23, 42];
        const C_TEXT = [71, 85, 105];
        const C_MUTED = [100, 116, 139];
        const C_SUBTLE = [148, 163, 184];
        const C_BORDER = [226, 232, 240];
        const C_WHITE = [255, 255, 255];

        /* Landscape A4 — the previous portrait layout was capped at ~182mm of
           content width, which forced the row font to 7.5pt and still didn't
           leave room for the Card # / Time columns sales agents expect from
           the reference report. Landscape gives us ~269mm — enough for the
           full denser tabular layout. Vertical real estate is tighter (210mm
           vs 297mm), so the header / cover / stats blocks all shrink to
           match.

           `compress: true` is the load-bearing flag for file size — jsPDF
           does NOT flate-encode document streams by default. Without this,
           a multi-page report ballooned to 10MB+ even after we'd already
           downscaled the logo. With it, the same report drops to <500KB.

           `putOnlyUsedFonts: true` tells jsPDF to write only the standard
           font definitions it actually used (helvetica) rather than the
           full 14 PDF standard fonts. Small but free saving. */
        const doc = new jsPDFCtor({
            unit: "mm",
            format: "a4",
            orientation: "landscape",
            compress: true,
            putOnlyUsedFonts: true,
        });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 14;
        const contentW = pageW - margin * 2;
        let y = 0;

        const addPageIfNeeded = (neededH) => {
            if (y + neededH > pageH - 18) {
                doc.addPage();
                y = 16;
            }
        };

        /* ── Orange header stripe (page 1) ─────────────────────────
           Combined title + carrier line + date range all live in the header
           band itself — the old separate "cover info" 30mm block was the
           heaviest waste of vertical room and isn't needed once the page
           is landscape. Header is taller (28mm) to fit the inline subtitle. */
        const HEADER_H = 28;
        doc.setFillColor(...C_ORANGE);
        doc.rect(0, 0, pageW, HEADER_H, "F");

        // Yellow accent line at the bottom of the stripe
        doc.setFillColor(...C_YELLOW);
        doc.rect(0, HEADER_H - 1.5, pageW, 1.5, "F");

        /* White logo block — left side of the orange stripe. The Octane
           mark is black + orange on transparent, so it would disappear on
           the orange header. A white rounded card behind it preserves the
           brand mark and balances the right-aligned title text. */
        let titleLeftX = margin;
        if (logo) {
            const blockSize = 20;
            const blockX = margin;
            const blockY = (HEADER_H - blockSize) / 2;
            doc.setFillColor(...C_WHITE);
            doc.roundedRect(blockX, blockY, blockSize, blockSize, 2, 2, "F");

            const pad = 2;
            const innerW = blockSize - pad * 2;
            const innerH = blockSize - pad * 2;
            const aspect = logo.w / logo.h;
            let dw, dh;
            if (aspect >= 1) { dw = innerW; dh = dw / aspect; }
            else             { dh = innerH; dw = dh * aspect; }
            const dx = blockX + (blockSize - dw) / 2;
            const dy = blockY + (blockSize - dh) / 2;
            doc.addImage(logo.dataUrl, logo.format || "JPEG", dx, dy, dw, dh, undefined, "FAST");
            titleLeftX = blockX + blockSize + 5;
        }

        // Title block — inline with logo on the left, eyebrow stack on right.
        // Serif display face (Times) for a formal report masthead; the data
        // tables below stay Helvetica for tabular legibility.
        doc.setFontSize(17);
        doc.setFont("times", "bold");
        doc.setTextColor(...C_WHITE);
        doc.text("Transaction Report", titleLeftX, 13);

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C_ORANGE_LITE);
        const subtitleParts = [
            `Carrier ${carrierId}`,
            summary.dateRange || `${startDate} to ${endDate}`,
        ].filter(Boolean);
        doc.text(subtitleParts.join("    ·    "), titleLeftX, 20);

        // Right eyebrow — small report label
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C_WHITE);
        doc.text("OCTANE FUEL CARDS", pageW - margin, 13, { align: "right" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C_ORANGE_LITE);
        doc.text("Carrier transactions detail", pageW - margin, 19, { align: "right" });

        y = HEADER_H + 5;

        /* ── Stats row — denser pill row, no separate cover ──────────
           Was 22mm tall; landscape needs ~30% less wasted vertical room. */
        const stats = [
            { label: "Transactions", value: String(summary.totalTransactions || transactions.length) },
            { label: "Total Spent", value: fmtCurrency(summary.totalFundedAmount || 0) },
            { label: "Discount", value: fmtCurrency(summary.totalDiscount || 0) },
            { label: "Cards", value: String(cardGroups.length) },
        ];
        if (summary.totalGallons != null) {
            stats.push({ label: "Qty", value: Number(summary.totalGallons).toFixed(2) });
        }
        if (options.addDataCaptureFee && summary.totalCarrierFee != null) {
            stats.push({ label: "Data Capture Fee", value: fmtCurrency(summary.totalCarrierFee || 0) });
        }
        const STAT_H = 14;
        const statW = contentW / stats.length;
        stats.forEach((stat, i) => {
            const sx = margin + i * statW;
            doc.setFillColor(...C_ORANGE_TINT);
            doc.setDrawColor(...C_ORANGE_MID);
            doc.roundedRect(sx, y, statW - 2, STAT_H, 2, 2, "FD");
            // Orange top accent on each stat box
            doc.setFillColor(...C_ORANGE);
            doc.roundedRect(sx, y, statW - 2, 2, 1, 1, "F");
            doc.setFontSize(11);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(...C_DARK);
            doc.text(stat.value, sx + (statW - 2) / 2, y + 8.5, { align: "center" });
            doc.setFontSize(6.5);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...C_MUTED);
            doc.text(stat.label, sx + (statW - 2) / 2, y + 12.4, { align: "center" });
        });
        y += STAT_H + 6;

        /* ── Dense, grouped transactions table ──────────────────────
           Landscape gives ~269mm of content width — enough to surface
           Card # and Time as their own columns (the reference report
           the sales team uses puts these front-and-center). Row height
           drops from 7mm to 5mm so 4+ transactions fit per inch of
           vertical space, which is the main "compress" win. */
        const C_GREEN = [21, 128, 61];   // #15803d — muted discount green (green-700)
        const C_ZEBRA = [250, 250, 251];
        const C_BAND = [248, 250, 252];
        const ROW_H = 5.6;
        const HEADER_ROW_H = 6.6;

        /* Column geometry — full EFS Transaction Report detail columns, one row
           per LINE ITEM. Card #, Driver, Unit live in the group header band, so
           the per-row columns are the EFS set minus those three. Landscape A4
           (~269mm content) at ~5.5pt fits all columns. Left-aligned text cols
           use cX (left edge); numeric cols use xR (right edge for align:right). */
        const cDate = margin + 2;      // Tran Date  yyyy-MM-dd
        const cInv  = margin + 22;     // Invoice
        const cOdo  = margin + 40;     // Odometer (no DWH source — always blank, per EFS)
        const cLoc  = margin + 58;     // Location Name (~46mm)
        const cCity = margin + 104;    // City
        const cSt   = margin + 125;    // State/Prov
        const feeR  = margin + 138;    // Fees (right)
        const cItem = margin + 140;    // Item
        const upR   = margin + 162;    // Unit Price (retail, right)
        const dppuR = margin + 178;    // Disc PPU (right)
        const dcR   = margin + 192;    // Disc Cost (right)
        const qtyR  = margin + 210;    // Qty / SCLE (right)
        const damtR = margin + 228;    // Disc Amt (right)
        const cDT   = margin + 230;    // Disc Type (left)
        const fundR = margin + contentW - 1; // Amt (rightmost, right) — DB column removed

        const fmtGal = (v) => {
            const n = Number(v);
            return (!n || Number.isNaN(n)) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        const fmtTime = (val) => {
            if (!val) return "";
            const d = new Date(val);
            if (isNaN(d)) return "";
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
        };

        /* Average per-unit price for the transaction. Falls back to "—" when
           the underlying line item didn't ship a ppu (rare on real data, but
           common in older test rows). */
        const txPpu = (tx) => {
            const key = retailOnly ? "retailPPU" : "ppu";
            const ppus = (tx.lineItems || [])
                .map(li => Number(li[key]))
                .filter(p => Number.isFinite(p) && p > 0);
            if (!ppus.length) return null;
            return ppus.reduce((s, p) => s + p, 0) / ppus.length;
        };

        /* EFS group/grand summary for a set of transactions (mirrors the
           component's efsSummary): by-item Amount/Qty/AvgPPU + fees/totals, and
           the discount breakdown bucketed by disc type (Cost Plus / No Deal /
           Retail Minus). */
        const efsDiscBucket = (code) => {
            const c = String(code || "").toUpperCase();
            if (c === "W" || c === "C") return "Cost Plus";
            if (c === "D") return "Retail Minus";
            if (c === "N") return "No Deal";
            return "Other";
        };
        const efsSummary = (txns) => {
            const itemMap = new Map(), discMap = new Map(), seenFee = new Set();
            let fees = 0, totalDisc = 0, totalQty = 0;
            (txns || []).forEach(tx => {
                // Fees obey the "Add data capture fee" display feature.
                if (addDataCaptureFee && !seenFee.has(tx.transactionId || tx.id)) { fees += Number(tx.carrierFee) || 0; seenFee.add(tx.transactionId || tx.id); }
                (tx.lineItems || []).forEach(li => {
                    const item = String(li.category || "—").toUpperCase();
                    const disc = Number(li.discAmount) || 0;
                    // When showDiscount is off, Amt shows retail (funded + discount), matching EFS behaviour.
                    const amt = (Number(li.amount) || 0) + (showDiscount ? 0 : disc);
                    const qty = Number(li.quantity) || 0;
                    if (!itemMap.has(item)) itemMap.set(item, { amount: 0, qty: 0 });
                    const it = itemMap.get(item); it.amount += amt; it.qty += qty; totalQty += qty;
                    const b = efsDiscBucket(li.discTypeCode);
                    if (!discMap.has(b)) discMap.set(b, { amount: 0, qty: 0 });
                    const db = discMap.get(b); db.amount += disc; db.qty += qty; totalDisc += disc;
                });
            });
            const byItem = [...itemMap.entries()].map(([item, v]) => ({ item, amount: v.amount, qty: v.qty, avgPpu: v.qty > 0 ? v.amount / v.qty : 0 })).sort((a, b) => a.item.localeCompare(b.item));
            const totalFuelAmount = byItem.reduce((s, r) => s + r.amount, 0);
            const discounts = ["Cost Plus", "No Deal", "Retail Minus"].map(name => {
                const v = discMap.get(name) || { amount: 0, qty: 0 };
                return { name, amount: v.amount, ppu: v.qty > 0 ? v.amount / v.qty : 0 };
            });
            return { byItem, fees, totalsAmount: totalFuelAmount + fees, totalFuelAmount, totalFuelQty: totalQty, discounts, totalDiscount: totalDisc, avgDiscount: totalQty > 0 ? totalDisc / totalQty : 0 };
        };

        /* Render the EFS summary as two side-by-side bordered GRIDS — exactly
           like the EFS Transaction Report footer: a "Fuel & Fees" table
           (Item · Amount · Quantity · Avg PPU) and a "Discount" table
           (Cost Plus / No Deal / Retail Minus · Disc Amt · Disc PPU · Total).
           Every row sits in its own bordered cell (horizontal grid lines +
           vertical column separators). Returns the bottom y of the taller grid. */
        const drawSummaryTables = (yStart, txns) => {
            const s = efsSummary(txns);
            const RH = 4.8;          // row height (header + each body row)
            const gap = 6;
            const lW = 150, rX = margin + lW + gap, rW = contentW - lW - gap;

            // Generic bordered grid renderer.
            //   x,w        : card position/width
            //   title      : header-bar label (col 0)
            //   colXs      : right-edge x of each numeric column (for align:right)
            //   seps       : x positions of vertical separator lines
            //   headers    : numeric-column header labels (same length as colXs)
            //   rows       : [{ cells:[{v,align,muted,green}], bold }]
            const grid = (x, w, title, seps, headers, colXs, rows) => {
                const h = RH * (rows.length + 1);   // +1 header row
                doc.setFillColor(...C_WHITE);
                doc.setDrawColor(...C_ORANGE_MID);
                doc.setLineWidth(0.3);
                doc.rect(x, yStart, w, h, "S");                 // outer box
                doc.setFillColor(...C_ORANGE);
                doc.rect(x, yStart, w, RH, "F");                // header bar
                // header text
                doc.setFontSize(6.2); doc.setFont("helvetica", "bold"); doc.setTextColor(...C_WHITE);
                doc.text(title, x + 2.5, yStart + 3.3);
                headers.forEach((t, i) => doc.text(t, colXs[i], yStart + 3.3, { align: "right" }));
                // horizontal grid lines (under each row)
                doc.setDrawColor(...C_BORDER); doc.setLineWidth(0.2);
                for (let i = 1; i <= rows.length; i++) doc.line(x, yStart + RH * i, x + w, yStart + RH * i);
                // vertical separators (full height of body)
                seps.forEach(sx => doc.line(sx, yStart + RH, sx, yStart + h));
                // body rows
                doc.setFontSize(6.4);
                rows.forEach((row, i) => {
                    const ry = yStart + RH * (i + 1) + 3.3;
                    doc.setFont("helvetica", row.bold ? "bold" : "normal");
                    row.cells.forEach(c => {
                        doc.setTextColor(...(c.green ? C_GREEN : c.muted ? C_MUTED : row.bold ? C_DARK : C_TEXT));
                        if (c.v !== "" && c.v != null) doc.text(String(c.v), c.x, ry, { align: c.align || "right" });
                    });
                });
                return yStart + h;
            };

            // ── Left grid: Fuel & Fees ──
            const lLab = margin + 2.5, lAmtR = margin + 84, lQtyR = margin + 118, lPpuR = margin + lW - 2.5;
            const lSeps = [margin + 50, margin + 88, margin + 122];
            const lRows = [];
            const cur = (v) => fmtCurrency(v);
            s.byItem.forEach(r => lRows.push({ cells: [
                { v: r.item, x: lLab, align: "left" },
                { v: cur(r.amount), x: lAmtR }, { v: fmtGal(r.qty), x: lQtyR }, { v: Number(r.avgPpu).toFixed(3), x: lPpuR, muted: true },
            ] }));
            lRows.push({ cells: [{ v: "Fees", x: lLab, align: "left" }, { v: cur(s.fees), x: lAmtR }] });
            lRows.push({ bold: true, cells: [{ v: "Totals", x: lLab, align: "left" }, { v: cur(s.totalsAmount), x: lAmtR }] });
            lRows.push({ bold: true, cells: [{ v: "Total Fuel", x: lLab, align: "left" }, { v: cur(s.totalFuelAmount), x: lAmtR }, { v: fmtGal(s.totalFuelQty), x: lQtyR }] });
            const lBottom = grid(margin, lW, "Fuel & Fees", lSeps, ["Amount", "Quantity", "Avg PPU"], [lAmtR, lQtyR, lPpuR], lRows);

            // ── Right grid: Discount — hidden when showDiscount is off (matches EFS) ──
            if (!showDiscount) { doc.setLineWidth(0.2); return lBottom; }
            const rLab = rX + 2.5, rAmtR = rX + 50, rPpuR = rX + 80, rTotR = rX + rW - 2.5;
            const rSeps = [rX + 34, rX + 56, rX + 84];
            const rRows = [];
            s.discounts.forEach(d => rRows.push({ cells: [
                { v: d.name, x: rLab, align: "left" },
                { v: cur(d.amount), x: rAmtR, green: d.amount > 0 }, { v: Number(d.ppu).toFixed(3), x: rPpuR, muted: true }, { v: cur(d.amount), x: rTotR },
            ] }));
            rRows.push({ bold: true, cells: [{ v: "Total Discount", x: rLab, align: "left" }, { v: cur(s.totalDiscount), x: rTotR }] });
            rRows.push({ bold: true, cells: [{ v: "Average Discount", x: rLab, align: "left" }, { v: Number(s.avgDiscount).toFixed(3), x: rTotR }] });
            const rBottom = grid(rX, rW, "Discount", rSeps, ["Disc Amt", "Disc PPU", "Total"], [rAmtR, rPpuR, rTotR], rRows);

            doc.setLineWidth(0.2);
            return Math.max(lBottom, rBottom);
        };

        const drawHeaderRow = (yPos) => {
            doc.setFillColor(...C_ORANGE);
            doc.rect(margin, yPos, contentW, HEADER_ROW_H, "F");
            doc.setFontSize(6.0);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(...C_WHITE);
            const ty = yPos + 4.1;
            doc.text("DATE", cDate, ty);
            doc.text("INVOICE", cInv, ty);
            doc.text("ODOMETER", cOdo, ty);
            doc.text("LOCATION", cLoc, ty);
            doc.text("CITY", cCity, ty);
            doc.text("ST", cSt, ty);
            doc.text("FEES", feeR, ty, { align: "right" });
            doc.text("ITEM", cItem, ty);
            doc.text("UNIT PRC", upR, ty, { align: "right" });
            if (!retailOnly && showDiscountDetail) doc.text("DISC PPU", dppuR, ty, { align: "right" });
            if (!retailOnly && showDiscountDetail) doc.text("DISC CST", dcR, ty, { align: "right" });
            doc.text("QTY", qtyR, ty, { align: "right" });
            if (showDiscount) doc.text("DISC AMT", damtR, ty, { align: "right" });
            doc.text("DT", cDT, ty);
            doc.text("AMOUNT", fundR, ty, { align: "right" });
            return yPos + HEADER_ROW_H;
        };

        const ensure = (h) => {
            if (y + h > pageH - 14) {
                doc.addPage();
                y = 12;
                y = drawHeaderRow(y);
            }
        };

        /* Grand totals + per-fuel-grade totals — computed upfront from every
           transaction so they stay correct no matter which display flags hide
           the detail rows (Remove Details / Grand Total Only). */
        let grandGal = 0, grandFunded = 0, grandDisc = 0;
        const fuelTotals = new Map();
        transactions.forEach(tx => {
            grandGal += Number(tx.fuelQuantity || 0);
            grandDisc += Number(tx.discAmount || 0);
            // When showDiscount is off, grand total shows retail (funded + discount).
            grandFunded += Number(tx.fundedTotal || 0) + (showDiscount ? 0 : Number(tx.discAmount || 0));
            (tx.lineItems || []).forEach(li => {
                const k = li.category || "—";
                const cur = fuelTotals.get(k) || { qty: 0, amt: 0 };
                const disc = Number(li.discAmount) || 0;
                cur.qty += Number(li.quantity || 0);
                cur.amt += (Number(li.amount) || 0) + (showDiscount ? 0 : disc);
                fuelTotals.set(k, cur);
            });
        });

        /* Grand-Total-Only skips the entire grouped table. */
        if (!grandTotalOnly) {
        y = drawHeaderRow(y);

        /* Each card-group renders as a fully-outlined block:
           ┌── GROUP N · CARD 7083 •••••••• 7713 · 3 txns ──── $1,385.27 ──┐
           │ DATE   TIME  LOCATION                 FUEL  GAL   PPU  FUND  │
           │ rows…                                                         │
           │ ULSD $1,348.73 (285.6 gal · 4.722) ·…  -$191.47 disc · totals │
           └────────────────────────────────────────────────────────────────┘
           The user explicitly asked for this in the latest feedback —
           the previous "Card # in row column" approach made it hard to
           see where one card's rows ended and the next began. */
        const GROUP_HEAD_H = 6.5;
        const GROUP_FOOT_H = 5.5;
        const GROUP_GAP    = 3;

        cardGroups.forEach((group, gi) => {
            const groupDiscount = group.transactions.reduce((s, t) => s + Number(t.discAmount || 0), 0);
            // When showDiscount is off, group header shows retail (funded + discount).
            const groupFunded = group.transactions.reduce((s, t) => s + Number(t.fundedTotal || 0) + (showDiscount ? 0 : Number(t.discAmount || 0)), 0);
            const groupGal = group.transactions.reduce((s, t) => s + Number(t.fuelQuantity || 0), 0);
            const maskedCard = groupByState ? group.state
                : groupByDriver ? group.driverLabel
                : (fullCardNumber ? String(group.cardNumber || "—") : maskCard(group.cardNumber));
            const txCount = group.transactions.length;
            /* Driver / unit summary for the group header. Grouping is usually by
               card, where the driver/unit is constant — so show the distinct
               value(s). Joins multiple with " / " on the rare multi-driver card. */
            const _distinct = (key) => {
                const seen = [];
                group.transactions.forEach(t => {
                    const v = String(t[key] || "").trim();
                    if (v && !seen.includes(v)) seen.push(v);
                });
                return seen;
            };
            const grpDrivers = _distinct("driverName");
            const grpIds     = _distinct("driverId");
            const grpUnits   = _distinct("unitNumber");
            const driverLabelParts = [];
            if (grpDrivers.length) driverLabelParts.push(grpDrivers.slice(0, 2).join(" / ") + (grpDrivers.length > 2 ? "…" : ""));
            if (grpIds.length)     driverLabelParts.push("ID " + grpIds.slice(0, 2).join("/") + (grpIds.length > 2 ? "…" : ""));
            if (grpUnits.length)   driverLabelParts.push("Unit " + grpUnits.slice(0, 2).join("/") + (grpUnits.length > 2 ? "…" : ""));
            const driverLabel = driverLabelParts.join(" · ");

            /* Per-group fuel-category aggregation drives the compact one-line
               summary at the bottom of the group ("ULSD $X (Y gal · Z avg)"). */
            const groupFuel = new Map();
            group.transactions.forEach(tx => {
                (tx.lineItems || []).forEach(li => {
                    const k = li.category || "—";
                    const cur = groupFuel.get(k) || { qty: 0, amt: 0 };
                    const disc = Number(li.discAmount) || 0;
                    cur.qty += Number(li.quantity || 0);
                    cur.amt += (Number(li.amount) || 0) + (showDiscount ? 0 : disc);
                    groupFuel.set(k, cur);
                });
            });

            /* Group block boundary tracking. When the group needs to wrap
               to a new page, we close the outline on the current page
               (so the box is properly enclosed) and start a fresh outline
               on the next page after the repeating column header. */
            let blockTop = y;

            const drawGroupHeader = (yPos) => {
                /* Header band — soft orange tint with the group label on
                   the left and the funded total on the right. */
                doc.setFillColor(...C_ORANGE_LITE);
                doc.rect(margin, yPos, contentW, GROUP_HEAD_H, "F");

                /* Left side: GROUP N · CARD <masked> · N txns */
                doc.setFontSize(7);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(...C_ORANGE);
                doc.text(`GROUP ${gi + 1}`, margin + 4, yPos + 4.4);

                doc.setTextColor(...C_DARK);
                doc.text(`· ${maskedCard}`, margin + 21, yPos + 4.4);

                doc.setFont("helvetica", "normal");
                doc.setTextColor(...C_MUTED);
                doc.text(`· ${txCount} txn${txCount === 1 ? "" : "s"}`, margin + 73, yPos + 4.4);

                /* Driver / unit summary (omitted when grouping by state, where it
                   would mix many drivers, or when the mart has no driver data). */
                if (!groupByState && !groupByDriver && driverLabel) {
                    doc.setTextColor(...C_TEXT);
                    doc.text(driverLabel.slice(0, 90), margin + 100, yPos + 4.4);
                }

                /* No totals on the group header band — the funded/discount totals
                   live only in the per-group summary cards at the BOTTOM, so the
                   top band stays a clean identity strip (avoids the duplicate-
                   totals confusion users reported). */
                return yPos + GROUP_HEAD_H;
            };

            /* Close the outline on whichever page we're on right now and
               break to a new page. Used when the group splits across pages. */
            const closeGroupOnPage = (endY) => {
                doc.setDrawColor(...C_ORANGE_MID);
                doc.setLineWidth(0.4);
                doc.rect(margin, blockTop, contentW, endY - blockTop, "S");
                doc.setLineWidth(0.2);
            };

            /* Drop the group header. If it won't fit on the current page,
               wrap first so we don't orphan a header at the bottom. */
            const projectedFirstSection = GROUP_HEAD_H + ROW_H;
            if (y + projectedFirstSection > pageH - 14) {
                doc.addPage();
                y = 12;
                y = drawHeaderRow(y);
            }
            blockTop = y;
            y = drawGroupHeader(y);

            /* Per-LINE-ITEM rows (full EFS detail columns). One row per fuel/item
               line; the transaction's Date/Invoice/Location/City/State/Fees show
               on its first line item only (matches EFS, where e.g. DEFD prints on
               its own line under the same transaction). Hidden when "Remove
               Details" is on. */
            const efsDiscCodeRow = (code) => {
                const c = String(code || "").toUpperCase();
                if (c === "W" || c === "C") return "CP";
                if (c === "D") return "RM";
                if (c === "N") return "ND";
                return "";
            };
            const f3 = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(3) : "");
            let rowIdx = 0;
            if (!removeDetails) group.transactions.forEach((tx) => {
                const items = (tx.lineItems && tx.lineItems.length) ? tx.lineItems : [{ category: "—" }];
                items.forEach((li, liIdx) => {
                    if (y + ROW_H > pageH - 14) {
                        closeGroupOnPage(y);
                        doc.addPage();
                        y = 12;
                        y = drawHeaderRow(y);
                        blockTop = y;
                        y = drawGroupHeader(y);
                    }
                    if (rowIdx % 2) { doc.setFillColor(...C_ZEBRA); doc.rect(margin, y, contentW, ROW_H, "F"); }
                    rowIdx++;
                    const ty = y + 3.5;
                    doc.setFontSize(6.0);
                    doc.setFont("helvetica", "normal");
                    const first = liIdx === 0;
                    // Transaction-level fields — first line item only.
                    doc.setTextColor(...C_TEXT);
                    // "Show transaction time" appends HH:MM after the date.
                    if (first) doc.text(fmtDate(tx.transactionDate) + (showTime ? "  " + fmtTime(tx.transactionDate) : ""), cDate, ty);
                    doc.setTextColor(...C_MUTED);
                    if (first) doc.text(String(tx.invoiceRef || "").slice(0, 14), cInv, ty);
                    doc.setTextColor(...C_DARK);
                    if (first) doc.text(String(tx.locationName || tx.location || "—").slice(0, 30), cLoc, ty);
                    doc.setTextColor(...C_MUTED);
                    if (first) doc.text(String(tx.locationCity || "").slice(0, 16), cCity, ty);
                    if (first) doc.text(String(tx.locationState || "").slice(0, 3), cSt, ty);
                    // Fees — only when "Add data capture fee" is on.
                    if (first && addDataCaptureFee && Number(tx.carrierFee) > 0) doc.text(Number(tx.carrierFee).toFixed(2), feeR, ty, { align: "right" });
                    // Line-item fields.
                    doc.setTextColor(...C_DARK);
                    doc.text(String(li.category || "—").slice(0, 6), cItem, ty);
                    doc.setTextColor(...C_MUTED);
                    doc.text(f3(li.retailPPU), upR, ty, { align: "right" });           // Unit Price (retail) — always
                    // Disc PPU + Disc Cost obey "Retail price only" / "Show discount detail".
                    if (!retailOnly && showDiscountDetail) {
                        doc.text(f3(li.ppu), dppuR, ty, { align: "right" });
                        doc.text(f3(li.discPerUnit), dcR, ty, { align: "right" });
                    }
                    doc.setTextColor(...C_DARK);
                    doc.text(Number(li.quantity) > 0 ? fmtGal(li.quantity) : "", qtyR, ty, { align: "right" });
                    // Disc Amt obeys "Show discount".
                    doc.setTextColor(...C_GREEN);
                    if (showDiscount) doc.text(Number(li.discAmount) > 0 ? Number(li.discAmount).toFixed(2) : "", damtR, ty, { align: "right" });
                    doc.setTextColor(...C_MUTED);
                    doc.text(efsDiscCodeRow(li.discTypeCode), cDT, ty);
                    doc.setTextColor(...C_DARK);
                    doc.setFont("helvetica", "bold");
                    // When showDiscount is off, Amt shows retail (funded + discount), matching EFS behaviour.
                    const rowAmt = (Number(li.amount) || 0) + (showDiscount ? 0 : (Number(li.discAmount) || 0));
                    doc.text(fmtCurrency(rowAmt), fundR, ty, { align: "right" });
                    doc.setFont("helvetica", "normal");
                    // Odometer (cOdo) intentionally left blank — no DWH source. DB column removed.

                    doc.setDrawColor(...C_BORDER);
                    doc.line(margin + 4, y + ROW_H, margin + contentW - 4, y + ROW_H);
                    y += ROW_H;
                });
            });

            /* Per-group summary — the full EFS footer: by-item Amount/Quantity/
               Avg PPU (+ Fees/Totals/Total Fuel) and the discount breakdown
               (Cost Plus / No Deal / Retail Minus + Total/Avg). Each group has
               its own totals. Hidden when "Remove Group Summary" is on. */
            if (!removeGroupSummary) {
                // Summary cards are self-contained (own bg + border). Reserve
                // enough room so they don't split across a page break.
                const needed = 60;
                if (y + needed > pageH - 14) {
                    closeGroupOnPage(y);
                    doc.addPage();
                    y = 12;
                    y = drawHeaderRow(y);
                    blockTop = y;
                    y = drawGroupHeader(y);
                }
                y = drawSummaryTables(y + 3, group.transactions);
                y += 2.5;
            }

            /* Close the outline around the entire group block. */
            closeGroupOnPage(y);
            y += GROUP_GAP;

            /* "Page Break per group" — start the next group on a fresh page. */
            if (pageBreak && gi < cardGroups.length - 1) {
                doc.addPage();
                y = 12;
                y = drawHeaderRow(y);
            }
        });
        } // end if(!grandTotalOnly)

        // ── Grand totals — full EFS by-item + discount breakdown ───────────
        ensure(70);
        doc.setFillColor(...C_ORANGE);
        doc.roundedRect(margin, y, contentW, 7, 1.2, 1.2, "F");
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C_WHITE);
        doc.text("GRAND TOTALS", margin + 4, y + 4.7);
        y += 10;
        y = drawSummaryTables(y, transactions);

        // ── Footer on every page ─────────────────────────────────
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            // Orange accent line above footer
            doc.setFillColor(...C_ORANGE);
            doc.rect(0, pageH - 11, pageW, 0.8, "F");
            doc.setFontSize(7.5);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...C_SUBTLE);
            doc.text(
                `Page ${p} of ${totalPages}  ·  Octane Fuel Cards  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
                pageW / 2,
                pageH - 6,
                { align: "center" }
            );
        }

        const safeName = String(carrierId).replace(/[^a-z0-9_-]+/gi, "-");
        const fileName = opts.fileName || `transactions-${safeName}-${startDate}-to-${endDate}.pdf`;
        /* Use the mobile-aware delivery helper when available (opens in a new
           tab inside the Zoho mobile app's WebView, where doc.save() — an
           anchor-download under the hood — silently fails). Falls back to the
           native save on desktop or if the helper isn't loaded. */
        if (window.MytrionDownload && typeof window.MytrionDownload.deliverBlob === "function") {
            window.MytrionDownload.deliverBlob(doc.output("blob"), fileName);
        } else {
            doc.save(fileName);
        }
    }

    // ── Public API ───────────────────────────────────────────
    return { generateTransactionsPdf };

})();
