import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  SUPPORT_BOT_GLOBAL_CARRIER,
  supportBotKnowledgeArticles,
  type NewSupportBotKnowledgeArticle,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { toVectorLiteral } from './util.js';

export interface SupportBotKnowledgeScope {
  carrierId: string;
  enabledServices: readonly string[];
}

export interface SupportBotKnowledgeHit {
  id: string;
  carrierId: string;
  slug: string;
  title: string;
  content: string;
  translations: Record<string, string>;
  serviceId: string | null;
  knowledgeType: 'static' | 'workflow' | 'tool_pointer';
  riskClass: 'read' | 'write' | 'sensitive';
  source: string | null;
  version: number;
  score: number;
}

export interface SupportBotKnowledgeUpsert {
  carrierId?: string;
  slug: string;
  title: string;
  content: string;
  translations?: Record<string, string>;
  keywords?: string;
  serviceId?: string | null;
  knowledgeType?: 'static' | 'workflow' | 'tool_pointer';
  riskClass?: 'read' | 'write' | 'sensitive';
  status?: 'draft' | 'published' | 'archived';
  source?: string;
  sourceEvidence?: Record<string, unknown>;
  version?: number;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  lastVerifiedAt?: Date | null;
  embedding?: number[] | null;
}

function serviceFilter(enabledServices: readonly string[]): SQL {
  if (enabledServices.length === 0) {
    return isNull(supportBotKnowledgeArticles.serviceId);
  }
  const filter = or(
    isNull(supportBotKnowledgeArticles.serviceId),
    inArray(supportBotKnowledgeArticles.serviceId, [...enabledServices]),
  );
  return filter ?? sql`false`;
}

function visibleWhere(
  ctx: TenantContext,
  scope: SupportBotKnowledgeScope,
): SQL {
  const filter = and(
    eq(supportBotKnowledgeArticles.tenantId, ctx.tenantId),
    eq(supportBotKnowledgeArticles.status, 'published'),
    or(
      eq(
        supportBotKnowledgeArticles.carrierId,
        SUPPORT_BOT_GLOBAL_CARRIER,
      ),
      eq(supportBotKnowledgeArticles.carrierId, scope.carrierId),
    ),
    serviceFilter(scope.enabledServices),
    or(
      isNull(supportBotKnowledgeArticles.effectiveAt),
      lte(supportBotKnowledgeArticles.effectiveAt, sql`now()`),
    ),
    or(
      isNull(supportBotKnowledgeArticles.expiresAt),
      sql`${supportBotKnowledgeArticles.expiresAt} > now()`,
    ),
  );
  return filter ?? sql`false`;
}

function selection() {
  return {
    id: supportBotKnowledgeArticles.id,
    carrierId: supportBotKnowledgeArticles.carrierId,
    slug: supportBotKnowledgeArticles.slug,
    title: supportBotKnowledgeArticles.title,
    content: supportBotKnowledgeArticles.content,
    translations: supportBotKnowledgeArticles.translations,
    serviceId: supportBotKnowledgeArticles.serviceId,
    knowledgeType: supportBotKnowledgeArticles.knowledgeType,
    riskClass: supportBotKnowledgeArticles.riskClass,
    source: supportBotKnowledgeArticles.source,
    version: supportBotKnowledgeArticles.version,
  };
}

export const supportBotKnowledgeRepo = {
  /** Exposed for structural tenant/carrier/service isolation tests without a live database. */
  buildVectorQuery(
    ctx: TenantContext,
    scope: SupportBotKnowledgeScope,
    embedding: number[],
    k: number,
  ) {
    const literal = toVectorLiteral(embedding);
    return db
      .select({
        ...selection(),
        score: sql<number>`1 - (${supportBotKnowledgeArticles.embedding} <=> ${literal}::vector)`,
      })
      .from(supportBotKnowledgeArticles)
      .where(
        and(
          visibleWhere(ctx, scope),
          isNotNull(supportBotKnowledgeArticles.embedding),
        ),
      )
      .orderBy(
        sql`${supportBotKnowledgeArticles.embedding} <=> ${literal}::vector`,
      )
      .limit(Math.max(1, k));
  },

  /** Simple dictionary keeps Uzbek/Russian/transliterated vocabulary searchable without stemming. */
  buildFullTextQuery(
    ctx: TenantContext,
    scope: SupportBotKnowledgeScope,
    query: string,
    k: number,
  ) {
    const tsQuery = sql`websearch_to_tsquery('simple', ${query})`;
    return db
      .select({
        ...selection(),
        score: sql<number>`ts_rank_cd(${supportBotKnowledgeArticles.contentTsv}, ${tsQuery})`,
      })
      .from(supportBotKnowledgeArticles)
      .where(
        and(
          visibleWhere(ctx, scope),
          sql`${supportBotKnowledgeArticles.contentTsv} @@ ${tsQuery}`,
        ),
      )
      .orderBy((aliases) => desc(aliases.score))
      .limit(Math.max(1, k));
  },

  async searchVector(
    ctx: TenantContext,
    scope: SupportBotKnowledgeScope,
    embedding: number[],
    k: number,
  ): Promise<SupportBotKnowledgeHit[]> {
    return this.buildVectorQuery(ctx, scope, embedding, k);
  },

  async searchFullText(
    ctx: TenantContext,
    scope: SupportBotKnowledgeScope,
    query: string,
    k: number,
  ): Promise<SupportBotKnowledgeHit[]> {
    return this.buildFullTextQuery(ctx, scope, query, k);
  },

  async upsert(
    ctx: TenantContext,
    input: SupportBotKnowledgeUpsert,
  ): Promise<{ id: string; slug: string; status: string }> {
    const carrierId =
      input.carrierId?.trim() || SUPPORT_BOT_GLOBAL_CARRIER;
    const translations = input.translations ?? {};
    const keywords = input.keywords ?? '';
    const serviceId = input.serviceId ?? null;
    const knowledgeType = input.knowledgeType ?? 'static';
    const riskClass = input.riskClass ?? 'read';
    const status = input.status ?? 'draft';
    const source = input.source ?? null;
    const sourceEvidence = input.sourceEvidence ?? {};
    const version = input.version ?? 1;
    const effectiveAt = input.effectiveAt ?? null;
    const expiresAt = input.expiresAt ?? null;
    const lastVerifiedAt = input.lastVerifiedAt ?? null;
    const embedding = input.embedding ?? null;
    const updatedAt = new Date();
    const values: NewSupportBotKnowledgeArticle = {
      tenantId: ctx.tenantId,
      carrierId,
      slug: input.slug,
      title: input.title,
      content: input.content,
      translations,
      keywords,
      serviceId,
      knowledgeType,
      riskClass,
      status,
      source,
      sourceEvidence,
      version,
      effectiveAt,
      expiresAt,
      lastVerifiedAt,
      embedding,
      updatedAt,
    };
    const rows = await db
      .insert(supportBotKnowledgeArticles)
      .values(values)
      .onConflictDoUpdate({
        target: [
          supportBotKnowledgeArticles.tenantId,
          supportBotKnowledgeArticles.carrierId,
          supportBotKnowledgeArticles.slug,
        ],
        set: {
          title: input.title,
          content: input.content,
          translations,
          keywords,
          serviceId,
          knowledgeType,
          riskClass,
          status,
          source,
          sourceEvidence,
          version,
          effectiveAt,
          expiresAt,
          lastVerifiedAt,
          embedding,
          updatedAt,
        },
      })
      .returning({
        id: supportBotKnowledgeArticles.id,
        slug: supportBotKnowledgeArticles.slug,
        status: supportBotKnowledgeArticles.status,
      });
    const row = rows[0];
    if (!row) throw new Error(`Failed to upsert support KB article "${input.slug}"`);
    return row;
  },

  async countPublished(
    ctx: TenantContext,
    carrierId = SUPPORT_BOT_GLOBAL_CARRIER,
  ): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportBotKnowledgeArticles)
      .where(
        and(
          eq(supportBotKnowledgeArticles.tenantId, ctx.tenantId),
          eq(supportBotKnowledgeArticles.carrierId, carrierId),
          eq(supportBotKnowledgeArticles.status, 'published'),
        ),
      );
    return rows[0]?.count ?? 0;
  },
};
