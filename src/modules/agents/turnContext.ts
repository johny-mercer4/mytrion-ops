import { createHash } from 'node:crypto';
import type { TenantContext } from '../../types/tenantContext.js';
import { xmlAttr, xmlElement, xmlText } from './contextXml.js';

export type ContextTrust = 'server-authenticated' | 'tool-observed' | 'retrieved-untrusted' | 'conversation';

export interface ContextClause {
  id: string;
  text: string;
  status: 'open' | 'resolved' | 'blocked';
}

export interface ContextToolFact {
  key: string;
  value: unknown;
  source: string;
  fetchedAt: string;
  expiresAt?: string;
}

export interface ContextNoMatch {
  query: string;
  scopeFingerprint: string;
  at: string;
}

export interface ContextEvidenceRef {
  id: string;
  source: string;
  trust: ContextTrust;
  fetchedAt?: string;
}

/** Canonical context state. Only `promptIdentity` and below are projected into model context. */
export interface TurnContextV1 {
  version: '1';
  server: {
    tenantId: string;
    principalRef: string;
    scopeFingerprint: string;
  };
  promptIdentity: {
    name?: string;
    zohoUserId?: string;
    profile?: string;
    role?: string;
    departments: string[];
    client?: {
      profile: string;
      carrierId?: string;
      applicationId?: string;
      cardId?: string;
      parentUserId?: string;
    };
  };
  task: {
    resolvedAsk: string;
    /**
     * True only when `resolvedAsk` carries something the raw message did not — i.e. history was
     * spliced in to resolve a pronoun. When false, `resolvedAsk` IS the raw message and must not
     * be used to override a caller's own (better) query. See `resolveAsk`.
     */
    anaphoraResolved: boolean;
    language: 'en' | 'ru' | 'uz' | 'unknown';
    constraints: string[];
    clauses: ContextClause[];
  };
  state: {
    entities: string[];
    toolFacts: ContextToolFact[];
    knownNoMatch: ContextNoMatch[];
    evidenceRefs: ContextEvidenceRef[];
    openQuestions: string[];
    recentHistory?: string;
  };
  budget: {
    maxChars: number;
    dropped: string[];
  };
}

export interface CreateTurnContextInput {
  ctx: TenantContext;
  message: string;
  historySummary?: string;
  userName?: string;
  zohoUserId?: string;
  profile?: string;
  role?: string;
  client?: TurnContextV1['promptIdentity']['client'];
  toolFacts?: ContextToolFact[];
  knownNoMatch?: ContextNoMatch[];
  evidenceRefs?: ContextEvidenceRef[];
  openQuestions?: string[];
  maxChars?: number;
}

function languageOf(text: string): TurnContextV1['task']['language'] {
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/\b(iltimos|qanday|uchun|kerak|mening|haqida|bo'yicha|qiling|bering)\b/i.test(text)) return 'uz';
  return /[A-Za-z]/.test(text) ? 'en' : 'unknown';
}

function clausesOf(message: string): ContextClause[] {
  const parts = message
    .split(/\b(?:and then|then|also|and|va|keyin|и|затем|также)\b|[;\n]+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
  return (parts.length > 0 ? parts : [message.trim()]).map((text, index) => ({
    id: `c${index + 1}`,
    text: text.slice(0, 1_000),
    status: 'open',
  }));
}

function entitiesOf(text: string): string[] {
  const values = text.match(/\b(?:[A-Z]{2,}[A-Z0-9_-]*|\d{5,})\b/g) ?? [];
  return [...new Set(values)].slice(0, 20);
}

export function scopeFingerprintFor(ctx: TenantContext): string {
  const input = JSON.stringify({
    tenantId: ctx.tenantId,
    audience: ctx.audience,
    role: ctx.role,
    departments: [...ctx.departments].sort(),
    allDepartmentAccess: ctx.allDepartmentAccess,
  });
  return createHash('sha256').update(input).digest('hex').slice(0, 20);
}

/**
 * Expand a pronoun-bearing follow-up ("what about that one?") with recent history so it can stand
 * alone. Returns `anaphoraResolved: false` — and the message verbatim — whenever there was nothing
 * to resolve, which is the common single-turn case.
 */
function resolveAsk(
  message: string,
  historySummary?: string,
): { text: string; anaphoraResolved: boolean } {
  const ask = message.trim();
  const anaphoric = /\b(it|that|those|them|there|he|she|they|bu|shu|ular|это|тот|они)\b/i.test(ask);
  if (!anaphoric || !historySummary) return { text: ask, anaphoraResolved: false };
  return {
    text: `Conversation context: ${historySummary.slice(-1_200)}\nCurrent request: ${ask}`,
    anaphoraResolved: true,
  };
}

export function createTurnContext(input: CreateTurnContextInput): TurnContextV1 {
  const scopeFingerprint = scopeFingerprintFor(input.ctx);
  const ask = resolveAsk(input.message, input.historySummary);
  return {
    version: '1',
    server: {
      tenantId: input.ctx.tenantId,
      principalRef: input.ctx.userId,
      scopeFingerprint,
    },
    promptIdentity: {
      ...(input.userName ? { name: input.userName } : {}),
      ...(input.zohoUserId ? { zohoUserId: input.zohoUserId } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.role ? { role: input.role } : {}),
      departments: [...input.ctx.departments],
      ...(input.client ? { client: input.client } : {}),
    },
    task: {
      resolvedAsk: ask.text,
      anaphoraResolved: ask.anaphoraResolved,
      language: languageOf(input.message),
      constraints: [],
      clauses: clausesOf(input.message),
    },
    state: {
      entities: entitiesOf(input.message),
      toolFacts: (input.toolFacts ?? []).slice(-16),
      knownNoMatch: (input.knownNoMatch ?? []).slice(-24),
      evidenceRefs: (input.evidenceRefs ?? []).slice(-20),
      openQuestions: (input.openQuestions ?? []).slice(-20),
      ...(input.historySummary ? { recentHistory: input.historySummary.slice(-3_600) } : {}),
    },
    budget: {
      maxChars: Math.max(12_000, Math.min(20_000, input.maxChars ?? 14_000)),
      dropped: [],
    },
  };
}

function factsXml(facts: ContextToolFact[]): string {
  if (facts.length === 0) return '';
  const body = facts
    .map((fact) => {
      const attrs: Record<string, unknown> = {
        key: fact.key,
        source: fact.source,
        fetchedAt: fact.fetchedAt,
        trust: 'tool-observed',
      };
      if (fact.expiresAt) attrs['expiresAt'] = fact.expiresAt;
      return `    <Fact${Object.entries(attrs).map(([k, v]) => ` ${k}="${xmlAttr(v)}"`).join('')}>${xmlText(fact.value, 1_000)}</Fact>`;
    })
    .join('\n');
  return `  <ToolFacts>\n${body}\n  </ToolFacts>`;
}

/** Safe, bounded prompt projection. Server tenant/principal ids are deliberately omitted. */
export function formatTurnContextXml(context: TurnContextV1): string {
  const dropped: string[] = [];
  const maxChars = Math.max(12_000, Math.min(20_000, context.budget.maxChars));
  const essential: string[] = [
    `<TurnContext version="1" scopeFingerprint="${xmlAttr(context.server.scopeFingerprint)}" trust="server-authenticated">`,
    xmlElement('Date', new Date().toISOString().slice(0, 10), { indent: 2 }),
    '  <UserIdentity trust="server-authenticated">',
    ...(context.promptIdentity.name ? [xmlElement('Name', context.promptIdentity.name, { indent: 4, maxChars: 120 })] : []),
    ...(context.promptIdentity.zohoUserId ? [xmlElement('ZohoUserId', context.promptIdentity.zohoUserId, { indent: 4, maxChars: 120 })] : []),
    ...(context.promptIdentity.profile ? [xmlElement('Profile', context.promptIdentity.profile, { indent: 4, maxChars: 120 })] : []),
    ...(context.promptIdentity.role ? [xmlElement('Role', context.promptIdentity.role, { indent: 4, maxChars: 80 })] : []),
    xmlElement('Departments', context.promptIdentity.departments.join(', '), { indent: 4, maxChars: 600 }),
    '  </UserIdentity>',
    '  <Task trust="conversation">',
    xmlElement('ResolvedAsk', context.task.resolvedAsk, { indent: 4, maxChars: 3_000 }),
    xmlElement('ReplyLanguage', context.task.language, { indent: 4, maxChars: 20 }),
    '    <Clauses>',
    ...context.task.clauses.slice(0, 6).map((clause) =>
      xmlElement('Clause', clause.text, { indent: 6, maxChars: 400, attrs: { id: clause.id, status: clause.status } }),
    ),
    '    </Clauses>',
    '  </Task>',
  ];

  if (context.promptIdentity.client) {
    const client = context.promptIdentity.client;
    essential.push('  <ClientIdentity trust="server-authenticated">');
    essential.push(xmlElement('Profile', client.profile, { indent: 4, maxChars: 120 }));
    if (client.carrierId) essential.push(xmlElement('CarrierId', client.carrierId, { indent: 4, maxChars: 120 }));
    if (client.applicationId) essential.push(xmlElement('ApplicationId', client.applicationId, { indent: 4, maxChars: 120 }));
    if (client.cardId) essential.push(xmlElement('CardId', client.cardId, { indent: 4, maxChars: 120 }));
    if (client.parentUserId) essential.push(xmlElement('ParentUserId', client.parentUserId, { indent: 4, maxChars: 120 }));
    essential.push('  </ClientIdentity>');
  }

  const optional = [
    factsXml(context.state.toolFacts),
    context.state.evidenceRefs.length
      ? `  <EvidenceRefs>${context.state.evidenceRefs.map((ref) => `<Evidence id="${xmlAttr(ref.id)}" source="${xmlAttr(ref.source)}" trust="${xmlAttr(ref.trust)}"/>`).join('')}</EvidenceRefs>`
      : '',
    context.state.knownNoMatch.some((item) => item.scopeFingerprint === context.server.scopeFingerprint)
      ? `  <KnownNoMatch>${context.state.knownNoMatch.filter((item) => item.scopeFingerprint === context.server.scopeFingerprint).map((item) => `<Miss at="${xmlAttr(item.at)}">${xmlText(item.query, 500)}</Miss>`).join('')}</KnownNoMatch>`
      : '',
    context.state.openQuestions.length
      ? xmlElement('OpenQuestions', context.state.openQuestions.join('; '), { indent: 2, maxChars: 2_000 })
      : '',
    context.state.recentHistory
      ? xmlElement('RecentHistory', context.state.recentHistory, { indent: 2, maxChars: 3_600, attrs: { trust: 'conversation' } })
      : '',
  ].filter(Boolean);

  const body = [...essential];
  for (const block of optional) {
    if ([...body, block, '</TurnContext>'].join('\n').length <= maxChars - 120) body.push(block);
    else dropped.push(block.match(/<([A-Za-z]+)/)?.[1] ?? 'optional-context');
  }
  body.push(`  <ContextBudget maxChars="${maxChars}" dropped="${xmlAttr(dropped.join(','))}"/>`);
  body.push('</TurnContext>');
  return body.join('\n');
}
