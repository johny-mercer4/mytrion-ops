/**
 * Diagnostic for issue #4: does resuming an on-disk session under a DIFFERENT token continue the
 * conversation? The whole "one token limited → next token keeps talking" premise rests on this.
 *
 *   Phase 1 (token A): fresh session, store a codeword. Capture the session id.
 *   Phase 2 (token B): RESUME that id, ask for the codeword back.
 *   PASS if B recalls the codeword → cross-token resume works (context survives a swap).
 *
 * With a single token configured, it degenerates to a same-token resume — still validates the
 * resume plumbing itself. Add ≥2 tokens (CLAUDE_CODE_OAUTH_TOKENS) for the true cross-account test.
 *
 *   pnpm tsx scripts/testCrossTokenResume.mts
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';

if (!process.env['IS_SANDBOX']) process.env['IS_SANDBOX'] = '1';

function parseTokens(): string[] {
  const raw: string[] = [];
  const multi = process.env['CLAUDE_CODE_OAUTH_TOKENS'];
  if (multi) raw.push(...multi.split(/[,\n]/));
  for (let i = 1; i <= 10; i++) {
    const v = process.env[`CLAUDE_CODE_OAUTH_TOKEN_${i}`];
    if (v) raw.push(v);
  }
  const single = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (single) raw.push(single);
  const seen = new Set<string>();
  return raw.map((t) => t.trim()).filter((t) => t && !seen.has(t) && (seen.add(t), true));
}

const mask = (t: string): string => `…${t.slice(-6)}`;
const MODEL = process.env['GATEWAY_MODEL'] ?? 'claude-sonnet-4-5';
const CODEWORD = 'TANGERINE-42';

/** One text turn (string-prompt mode = exactly the gateway's text path). Returns session id + reply. */
async function turn(token: string, text: string, resume?: string): Promise<{ sessionId: string; reply: string }> {
  const q = query({
    prompt: text,
    options: { env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token }, model: MODEL, maxTurns: 2, ...(resume ? { resume } : {}) },
  });
  let sessionId = '';
  let reply = '';
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    if (m.type === 'result') reply = m.subtype === 'success' ? m.result : `[${m.subtype}]`;
  }
  return { sessionId, reply };
}

async function main(): Promise<void> {
  const toks = parseTokens();
  if (!toks.length) {
    console.error('no tokens configured');
    process.exit(1);
  }
  const a = toks[0]!;
  const b = toks[1] ?? toks[0]!;
  const crossAccount = a !== b;
  console.log(`Phase 1 token ${mask(a)} → Phase 2 token ${mask(b)}  (${crossAccount ? 'CROSS-token' : 'same token — plumbing only'})\n`);

  console.log('Phase 1: storing codeword…');
  const p1 = await turn(a, `Remember this codeword for later: ${CODEWORD}. Reply with only the word: stored`);
  console.log(`  session=${p1.sessionId}  reply=${JSON.stringify(p1.reply.slice(0, 80))}`);
  if (!p1.sessionId) {
    console.log('🔴 FAIL: no session id from phase 1');
    process.exit(1);
  }

  console.log('Phase 2: resuming under the second token, asking for it back…');
  let p2: { sessionId: string; reply: string };
  try {
    p2 = await turn(b, 'What codeword did I ask you to remember? Reply with ONLY the codeword, nothing else.', p1.sessionId);
  } catch (e) {
    console.log(`🔴 FAIL: resume under ${mask(b)} threw: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  console.log(`  reply=${JSON.stringify(p2.reply.slice(0, 80))}`);

  const recalled = p2.reply.toUpperCase().includes(CODEWORD);
  console.log('');
  if (recalled) {
    console.log(`🟢 PASS: ${crossAccount ? 'CROSS-token' : 'same-token'} resume preserved context — the conversation continues across the swap.`);
  } else {
    console.log(`🔴 FAIL: the codeword was NOT recalled after resume — context did not survive${crossAccount ? ' the token swap' : ''}.`);
    process.exit(1);
  }
}

void main();
