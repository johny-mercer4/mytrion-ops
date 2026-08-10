/**
 * The check that jsdom cannot do: does the page actually overflow?
 *
 * Every automated test in this repo runs in jsdom, which does no layout at all — so 697 green tests
 * prove structure and prove nothing about geometry. This drives real Chrome over CDP, sets a real
 * viewport, and asks the rendered document two questions no unit test can answer:
 *
 *   1. Is `documentElement.scrollWidth` greater than the viewport? That is the single check that
 *      catches every fixed width, every un-shrinkable flex item and every grid track floor at once.
 *   2. WHICH elements are wider than the viewport? Reported with a CSS path, so a failure names the
 *      file to open rather than just saying "something is too wide".
 *
 * No new dependencies: Chrome is driven through the DevTools Protocol over the WebSocket that
 * Node 24 ships natively.
 *
 * Usage:
 *   node scripts/mobile-audit.mjs [--url http://localhost:5175] [--json]
 * Requires a dev server with VITE_DEV_MOCK_AUTH=1 so the routes render behind the Zoho gate.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:5175';
const AS_JSON = args.includes('--json');

/** The ladder, plus the boundaries either side of the structure line. */
const VIEWPORTS = [
  { w: 320, h: 640, label: '320  small phone' },
  { w: 375, h: 667, label: '375  iPhone SE' },
  { w: 430, h: 932, label: '430  iPhone Pro Max' },
  { w: 639, h: 800, label: '639  just below structure' },
  { w: 640, h: 800, label: '640  structure line' },
  { w: 820, h: 1180, label: '820  iPad portrait' },
  { w: 1280, h: 900, label: '1280 desktop' },
];

const ROUTES = [
  ['/kitchen', 'Design system'],
  ['/main', 'Launcher'],
  ['/main/salesmytrion', 'Sales'],
  ['/main/csmytrion', 'Customer Service'],
  ['/main/billingmytrion', 'Billing'],
  ['/main/managermytrion', 'Manager'],
  ['/main/hrmytrion', 'HR'],
  ['/main/adminmytrion', 'Admin'],
  ['/main/financemytrion', 'Finance'],
  ['/main/analystmytrion', 'Analyst'],
  ['/main/recruitmytrion', 'Recruit'],
  ['/main/verificationmytrion', 'Verification'],
  ['/main/collectionmytrion', 'Collection'],
];

/* ── CDP ───────────────────────────────────────────────────────────────────── */

let nextId = 1;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      }),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs INSIDE the page. Returns the overflow verdict plus the widest offenders.
 *
 * `getBoundingClientRect().right > innerWidth + 1` rather than scrollWidth per element: a child can
 * be wider than its parent without the parent reporting it (the parent may clip), and what actually
 * matters is whether anything paints past the right edge. The 1px tolerance absorbs sub-pixel
 * rounding at fractional device ratios.
 */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const over = [];
  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { bits.unshift(s + '#' + n.id); break; }
      const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      bits.unshift(s);
    }
    return bits.join(' > ');
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') { clipped = true; break; }
      }
      if (!clipped) over.push({ sel: path(el), right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  over.sort((a, b) => b.right - a.right);
  const seen = new Set();
  const uniq = over.filter((o) => (seen.has(o.sel) ? false : seen.add(o.sel)));
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    pageOverflows: document.documentElement.scrollWidth > vw + 1,
    offenders: uniq.slice(0, 6),
    title: document.title,
    hasShell: !!document.querySelector('[data-mytrion]'),
    hasTabBar: [...document.querySelectorAll('nav[aria-label$="navigation"]')].some((n) => !n.id),
    smallFields: [...document.querySelectorAll('input, textarea, select')]
      .filter((f) => parseFloat(getComputedStyle(f).fontSize) < 16)
      .map((f) => path(f) + ' @' + getComputedStyle(f).fontSize)
      .slice(0, 4),
  };
})()`;

/* ── main ──────────────────────────────────────────────────────────────────── */

const profile = mkdtempSync(join(tmpdir(), 'mytrion-audit-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  'about:blank',
]);
chrome.on('error', (e) => {
  console.error('chrome failed to start:', e.message);
  process.exit(1);
});

let target;
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  try {
    const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error('could not reach Chrome DevTools');
  process.exit(1);
}

const cdp = await connect(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const results = [];
for (const [route, name] of ROUTES) {
  for (const vp of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: 1,
      mobile: vp.w < 640,
    });
    await cdp.send('Page.navigate', { url: BASE + route });
    // Let the SPA mount, fetch and settle. Lazy module chunks make this necessary.
    await sleep(2600);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: false,
    });
    results.push({ route, name, vp: vp.label, w: vp.w, ...(result.value ?? { error: 'probe failed' }) });
  }
}

await cdp.send('Emulation.clearDeviceMetricsOverride');
cdp.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* best effort */
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

let fails = 0;
let zoomFails = 0;
for (const [route, name] of ROUTES) {
  const rows = results.filter((r) => r.route === route);
  const bad = rows.filter((r) => r.pageOverflows);
  const zoom = rows.filter((r) => r.w < 900 && (r.smallFields ?? []).length > 0);
  fails += bad.length;
  zoomFails += zoom.length;
  const mark = bad.length === 0 && zoom.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n${mark}  ${name.padEnd(18)} ${route}`);
  if (!rows.some((r) => r.hasShell) && route.startsWith('/main/')) {
    console.log('      (no shell rendered — auth gate or load error)');
  }
  for (const r of bad) {
    console.log(`      ${r.vp}: page is ${r.scrollWidth}px in a ${r.vw}px viewport`);
    for (const o of r.offenders) console.log(`          ${o.width}px  ${o.sel}`);
  }
  for (const r of zoom) {
    console.log(`      ${r.vp}: sub-16px fields -> iOS will zoom`);
    for (const f of r.smallFields) console.log(`          ${f}`);
  }
}
console.log(
  `\n${results.length} route x viewport combinations · ${fails} overflowing · ${zoomFails} with sub-16px fields`,
);
process.exit(fails + zoomFails > 0 ? 1 : 0);
