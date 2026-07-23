/**
 * Web monitor — every bot turn on one page: WHO asked WHAT, how long the queue held it, how
 * long Claude worked, and exactly how many tokens it cost (input / output / cache read /
 * cache write, straight from the SDK result message).
 *
 * Zero dependencies: node:http serving one self-contained HTML page + one JSON endpoint.
 *   GET /            — dashboard (auto-refreshes every 5s)
 *   GET /api/turns   — last 200 turns + aggregates
 *
 * Persistence: data/turns.jsonl (same volume as sessions.json) — append-only, last 1000 kept
 * in memory. Internal tool: bind stays 0.0.0.0 for docker port-mapping; do NOT expose the
 * port publicly (set MONITOR_TOKEN to require ?token= on every request if you must).
 */
import { createServer, type ServerResponse } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';

export interface TurnLog {
  ts: string;
  chatId: number;
  userId: number;
  name: string;
  kind: 'message' | 'button';
  question: string;
  reply: string;
  waitMs: number;
  execMs: number;
  numTurns: number;
  inTok: number;
  outTok: number;
  cacheRead: number;
  cacheWrite: number;
  isError: boolean;
}

const FILE = 'data/turns.jsonl';
const MAX_MEM = 1000;
let recent: TurnLog[] = [];
let lastMtimeMs = -1;

/** Reload recent[] from the JSONL when the file changed since the last read, so a process that
 *  only appended to the file (not via our recordTurn) is still reflected live. mtime-guarded so a
 *  steady dashboard poll is a cheap stat(), not a full parse. */
function syncFromFile(): void {
  try {
    if (!existsSync(FILE)) return;
    const m = statSync(FILE).mtimeMs;
    if (m === lastMtimeMs) return;
    lastMtimeMs = m;
    const next: TurnLog[] = [];
    for (const ln of readFileSync(FILE, 'utf8').trim().split('\n').slice(-MAX_MEM)) {
      if (!ln) continue;
      try { next.push(JSON.parse(ln) as TurnLog); } catch { /* skip corrupt line */ }
    }
    recent = next;
  } catch { /* first boot / transient read race — keep what we have */ }
}
syncFromFile();

export function recordTurn(e: TurnLog): void {
  recent.push(e);
  if (recent.length > MAX_MEM) recent.shift();
  try {
    mkdirSync('data', { recursive: true });
    appendFileSync(FILE, JSON.stringify(e) + '\n');
    // Our own append advanced mtime — record it so the next read doesn't needlessly reparse the
    // file just to rediscover the row we already hold in memory.
    lastMtimeMs = statSync(FILE).mtimeMs;
  } catch (err) {
    console.error('[monitor] failed to persist turn', err);
  }
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

function aggregates() {
  const dayAgo = Date.now() - 24 * 3600_000;
  const day = recent.filter((r) => Date.parse(r.ts) >= dayAgo);
  const sum = (rows: TurnLog[], f: (r: TurnLog) => number) => rows.reduce((s, r) => s + f(r), 0);
  const execs = day.map((r) => r.execMs);
  const cacheRead = sum(day, (r) => r.cacheRead);
  const rawIn = sum(day, (r) => r.inTok) + sum(day, (r) => r.cacheWrite);
  return {
    turns24h: day.length,
    errors24h: day.filter((r) => r.isError).length,
    execP50Ms: pct(execs, 50),
    execP90Ms: pct(execs, 90),
    waitMaxMs: pct(day.map((r) => r.waitMs), 100),
    inTok: sum(day, (r) => r.inTok),
    outTok: sum(day, (r) => r.outTok),
    cacheRead,
    cacheWrite: sum(day, (r) => r.cacheWrite),
    cacheHitPct: cacheRead + rawIn > 0 ? Math.round((100 * cacheRead) / (cacheRead + rawIn)) : 0,
  };
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const HTML = `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Octane Agent Bot — Monitor</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--border:#2a2f3a;--fg:#e8eaf0;--muted:#8b93a3;--ok:#4ade80;--bad:#f87171;--acc:#60a5fa}
*{box-sizing:border-box}body{margin:0;padding:24px 18px;background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif}
h1{font-size:17px;margin:0 0 2px}.sub{color:var(--muted);font-size:11.5px;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.tile{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
.tile .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.tile .v{font-size:19px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:top}
th{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:#1d2129}
/* Full question + reply: wrap, don't truncate. */
td.q,td.r{max-width:340px;white-space:normal;word-break:break-word;line-height:1.35}
td.q{color:var(--fg)} td.r{color:var(--muted)}
.err{color:var(--bad);font-weight:700}.okb{color:var(--ok)}
</style></head><body>
<h1>Octane Agent Bot — Monitor</h1><div class="sub">oxirgi 24 soat · 5s auto-refresh · <span id="upd"></span></div>
<div class="tiles" id="tiles"></div>
<table><thead><tr><th>Vaqt</th><th>Kim</th><th>Savol</th><th>Kutish</th><th>Bajarish</th><th>Turnlar</th><th>In</th><th>Out</th><th>Cache o'qish</th><th>Cache yozish</th><th>Javob</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const s=(ms)=> (ms/1000).toFixed(1)+'s';
const k=(n)=> n>=1000? (n/1000).toFixed(1)+'k' : String(n);
async function load(){
 try{
  const d=await (await fetch('api/turns'+location.search)).json();
  const a=d.agg;
  document.getElementById('tiles').innerHTML=[
   ['Turnlar (24h)',a.turns24h],['Xatolar',a.errors24h],['Exec P50',s(a.execP50Ms)],['Exec P90',s(a.execP90Ms)],
   ['Max kutish',s(a.waitMaxMs)],['In tok',k(a.inTok)],['Out tok',k(a.outTok)],
   ['Cache o\\'qish',k(a.cacheRead)],['Cache hit',a.cacheHitPct+'%']
  ].map(([l,v])=>'<div class="tile"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>').join('');
  const esc=(x)=>String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  document.getElementById('rows').innerHTML=d.turns.map(r=>{
   const t=new Date(r.ts).toLocaleTimeString('en-GB');
   return '<tr><td>'+t+'</td><td>'+esc(r.name)+'</td><td class="q">'+esc(r.question)+'</td>'+
    '<td>'+s(r.waitMs)+'</td><td>'+s(r.execMs)+'</td><td>'+r.numTurns+'</td><td>'+k(r.inTok)+'</td><td>'+k(r.outTok)+'</td>'+
    '<td>'+k(r.cacheRead)+'</td><td>'+k(r.cacheWrite)+'</td>'+
    '<td class="r '+(r.isError?'err':'okb')+'">'+(r.isError?esc(r.reply||'ERROR'):esc(r.reply||'(silent)'))+'</td></tr>';
  }).join('');
  document.getElementById('upd').textContent=new Date().toLocaleTimeString('en-GB');
 }catch(e){console.error(e)}
}
load();setInterval(load,5000);
</script></body></html>`;

export function startMonitor(): void {
  const port = Number(process.env['MONITOR_PORT'] ?? '8787');
  const token = process.env['MONITOR_TOKEN'] ?? '';
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (token && url.searchParams.get('token') !== token) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (url.pathname === '/api/turns') {
      syncFromFile(); // reflect any turns appended to the file since the last read
      json(res, { turns: [...recent].slice(-200).reverse(), agg: aggregates() });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  })
    .on('error', (err: NodeJS.ErrnoException) => {
      // A second process on the same port must not crash the bot — log and carry on.
      console.error(`[monitor] not started on :${port} — ${err.code === 'EADDRINUSE' ? 'port busy' : err.message}`);
    })
    .listen(port, '0.0.0.0', () => console.log(`[monitor] http://localhost:${port}`));
}
