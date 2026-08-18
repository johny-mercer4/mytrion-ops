/**
 * The inbox's vocabulary.
 *
 * The two that matter: an event type the desk has not been taught about must still read as a
 * sentence rather than a snake_case code, and the timeline must contain only facts the row carries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InboxMessage } from '@/api/inbox';
import {
  caseIdFromSource,
  humanizeType,
  inScope,
  isUnread,
  scopeTabs,
  styleFor,
  timelineFor,
  TYPE_STYLE,
  whenLabel,
} from './inboxModel';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');

function msg(over: Partial<InboxMessage> & { id: string }): InboxMessage {
  return {
    name: null,
    subject: `Subject ${over.id}`,
    content: 'Body',
    type: 'verification.application.created',
    priority: 'medium',
    tag: 'verification',
    sourceUrl: null,
    createdTime: new Date(NOW - 3_600_000).toISOString(),
    ownerId: '6227679000000000001',
    ownerName: 'John Mercer',
    ownerEmail: null,
    readAt: null,
    ...over,
  };
}

describe('event types', () => {
  it('names every verification type this codebase can actually produce', () => {
    // The producers are the two notify modules; a type added there must not reach the UI as a code.
    const sources = ['src/modules/verification/caseNotify.ts', 'src/modules/verificationFlow/notify.ts'];
    const produced = new Set<string>();
    for (const rel of sources) {
      const text = readFileSync(join(process.cwd(), '../..', rel), 'utf8');
      for (const m of text.matchAll(/type:\s*'(verification\.[a-z_.]+)'/g)) produced.add(m[1]!);
    }
    expect(produced.size).toBeGreaterThanOrEqual(3);
    expect([...produced].filter((t) => !TYPE_STYLE[t])).toEqual([]);
  });

  it('turns an unknown dotted event into a sentence rather than a code', () => {
    expect(humanizeType('verification.limit.raised')).toBe('Limit raised');
    expect(humanizeType('verification.case.pending_docs')).toBe('Case pending docs');
    const style = styleFor('verification.something.new');
    expect(style.label).toBe('Something new');
    expect(style.tone).toBe('plain');
  });

  it('keeps a known type on its own tone and glyph', () => {
    expect(styleFor('verification.case.blacklisted')).toMatchObject({ tone: 'danger', icon: 'block' });
  });
});

describe('scopes', () => {
  const messages = [
    msg({ id: 'a' }),
    msg({ id: 'b', readAt: new Date(NOW).toISOString() }),
    msg({ id: 'c', type: 'verification.case.created' }),
  ];

  it('offers All, Unread, then a tab per type PRESENT — never an empty bucket', () => {
    const tabs = scopeTabs(messages);
    expect(tabs.map((t) => t.id)).toEqual([
      'all',
      'unread',
      'verification.application.created',
      'verification.case.created',
    ]);
    expect(tabs.map((t) => t.count)).toEqual([3, 2, 2, 1]);
    // The design's fixed Documents / Escalations / SLA tabs have no producer, so they never appear.
    expect(tabs.some((t) => /document|escalation|sla/i.test(t.label))).toBe(false);
  });

  it('has no tabs at all for an empty inbox beyond the two globals', () => {
    expect(scopeTabs([]).map((t) => t.id)).toEqual(['all', 'unread']);
  });

  it('filters on the same predicate the counts use', () => {
    for (const tab of scopeTabs(messages)) {
      expect(messages.filter((m) => inScope(m, tab.id))).toHaveLength(tab.count);
    }
  });

  it('reads unread off readAt, which is the column the route writes', () => {
    expect(isUnread(msg({ id: 'a' }))).toBe(true);
    expect(isUnread(msg({ id: 'b', readAt: new Date(NOW).toISOString() }))).toBe(false);
  });
});

describe('linked case', () => {
  it('finds the case on every shape the notifiers write', () => {
    expect(caseIdFromSource('/verification/applicants/vc_abcdefgh1')).toBe('vc_abcdefgh1');
    expect(caseIdFromSource('/verification/cases/vc_abcdefgh1')).toBe('vc_abcdefgh1');
    expect(caseIdFromSource('/verification/flow/cases/vc_abcdefgh1')).toBe('vc_abcdefgh1');
    expect(caseIdFromSource('/sales/verification/vc_abcdefgh1')).toBe('vc_abcdefgh1');
  });

  it('returns null rather than a guess when there is no case in the link', () => {
    expect(caseIdFromSource(null)).toBeNull();
    expect(caseIdFromSource('/inbox')).toBeNull();
  });
});

describe('timeline', () => {
  it('carries only facts the row holds — no invented routing hops', () => {
    const events = timelineFor(msg({ id: 'a' }));
    expect(events.map((e) => e.text)).toEqual([
      'New application raised',
      'Addressed to John Mercer',
      'Unread',
    ]);
    // The design drew "Routed to the Verification queue" / "Assigned to …"; no column records those.
    expect(events.some((e) => /routed|assigned/i.test(e.text))).toBe(false);
  });

  it('stamps the read time once the message has been read', () => {
    const read = timelineFor(msg({ id: 'a', readAt: new Date(NOW).toISOString() }));
    expect(read.at(-1)?.text).toBe('Read');
    expect(read.at(-1)?.when).not.toBe('—');
  });

  it('drops the addressee line when the row has no owner name', () => {
    expect(timelineFor(msg({ id: 'a', ownerName: null })).map((e) => e.text)).toEqual([
      'New application raised',
      'Unread',
    ]);
  });
});

describe('when', () => {
  it('says today, yesterday, or the date — shortest form that is unambiguous', () => {
    expect(whenLabel(new Date(NOW - 3_600_000).toISOString(), NOW)).toMatch(/today$/);
    // 36 hours back is yesterday relative to a midday NOW.
    expect(whenLabel(new Date(NOW - 36 * 3_600_000).toISOString(), NOW)).toMatch(/^Yesterday/);
    expect(whenLabel(new Date(NOW - 10 * 86_400_000).toISOString(), NOW)).not.toMatch(
      /today|Yesterday/,
    );
  });

  it('renders an em dash for an unparseable stamp rather than Invalid Date', () => {
    expect(whenLabel('not-a-date', NOW)).toBe('—');
  });
});
