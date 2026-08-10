/**
 * Screenshots at real viewport widths, for the check no assertion replaces: looking at it.
 *
 * Companion to mobile-audit.mjs — that one answers "does it overflow", this one answers "is it
 * usable". Same CDP-over-native-WebSocket approach, no dependencies.
 *
 *   node scripts/mobile-shots.mjs --url http://localhost:5175 --out /tmp/shots [--width 375]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = arg('--url', 'http://localhost:5175');
const OUT = arg('--out', '/tmp/shots');
const WIDTH = Number(arg('--width', '375'));
const HEIGHT = Number(arg('--height', '780'));

const ROUTES = [
  ['/main/salesmytrion', 'sales'],
  ['/main/billingmytrion', 'billing'],
  ['/main/csmytrion', 'cs'],
  ['/main/hrmytrion', 'hr'],
  ['/main/adminmytrion', 'admin'],
  ['/main/analystmytrion', 'analyst'],
  ['/kitchen', 'kitchen'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
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

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'mytrion-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9334',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
]);

let target;
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  try {
    const list = await (await fetch('http://127.0.0.1:9334/json/list')).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error('no Chrome target');
  process.exit(1);
}

const cdp = await connect(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
// Console + page errors, so a blank screenshot is explained rather than mysterious.
const problems = new Map();
await cdp.send('Log.enable').catch(() => {});

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 2,
  mobile: WIDTH < 640,
});

for (const [route, slug] of ROUTES) {
  await cdp.send('Page.navigate', { url: BASE + route });
  await sleep(3000);
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => ({
      text: (document.body.innerText || '').slice(0, 220),
      nodes: document.body.querySelectorAll('*').length,
      err: [...document.querySelectorAll('[role="alert"], .ss-err, .cs-banner-danger')].map(e => e.textContent.slice(0,120)),
    }))()`,
    returnByValue: true,
  });
  problems.set(slug, result.value);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, `${slug}-${WIDTH}.png`), Buffer.from(shot.data, 'base64'));
  console.log(
    `${slug.padEnd(9)} ${result.value.nodes} nodes  ${result.value.err.length ? 'ERR: ' + result.value.err[0] : ''}`,
  );
  console.log(`          ${(result.value.text || '(empty)').replace(/\s+/g, ' ').slice(0, 120)}`);
}

cdp.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* best effort */
}
console.log(`\nwrote ${ROUTES.length} shots at ${WIDTH}px to ${OUT}`);
