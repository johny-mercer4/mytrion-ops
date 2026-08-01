/**
 * KB-2 retrieval — a tiny, dependency-free keyword search over the bundled client-safe corpus
 * (corpus.ts). No embeddings/infra: the corpus is small and curated, so weighted token overlap
 * (title/tags/triggers weigh more than body) ranks well and stays deterministic. The tool returns
 * the top few articles; the model then answers in the client's language and states facts ONLY from
 * the returned text (octane-kb HARD RULE). Pure in-process — no carrier data, no backend round-trip.
 */
import { KB_ARTICLES, type KbArticle } from './corpus.js';
import { config } from '../config.js';
import { incrementCounter } from '../metrics.js';

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'is', 'are', 'it', 'and', 'or', 'how', 'what',
  'my', 'me', 'do', 'does', 'can', 'you', 'your', 'with', 'at', 'be', 'this', 'that', 'ok',
  'nima', 'uchun', 'qanday', 'qancha', 'bor', 'yoki', 'va', 'men', 'mening', 'shu', 'bu', 'qilib',
  'chto', 'kak', 'dlya', 'moy', 'eto', 'что', 'как', 'и', 'или', 'для', 'мой', 'моя', 'это',
]);

/** Lowercase, strip Latin diacritics + punctuation, keep letters/digits (incl. Cyrillic). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

interface Indexed {
  art: KbArticle;
  title: Set<string>;
  tagTrig: Set<string>;
  body: Set<string>;
}

// Index each article's searchable text once at module load.
const INDEX: Indexed[] = KB_ARTICLES.map((art) => ({
  art,
  title: new Set(tokenize(art.title)),
  tagTrig: new Set([...art.tags, ...art.triggers].flatMap(tokenize)),
  body: new Set(tokenize([art.en, art.uz ?? '', art.ru ?? ''].join(' '))),
}));

export interface KbHit {
  id: string;
  title: string;
  en: string;
  uz?: string;
  ru?: string;
  translations?: Record<string, string>;
  serviceId?: string | null;
  score: number;
}

/** Rank the corpus against a free-text query; return the top `limit` articles (score-descending). */
export function searchKb(
  query: string,
  limit = 3,
  enabledServices?: ReadonlySet<string>,
): KbHit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const scored = INDEX.filter(({ art }) => {
    const serviceId = localArticleService(art);
    return serviceId === null || !enabledServices || enabledServices.has(serviceId);
  }).map(({ art, title, tagTrig, body }) => {
    let score = 0;
    for (const t of q) {
      if (title.has(t)) score += 3;
      if (tagTrig.has(t)) score += 3;
      if (body.has(t)) score += 1;
    }
    return { art, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ art, score }) => ({
    id: art.id,
    title: art.title,
    en: art.en,
    ...(art.uz ? { uz: art.uz } : {}),
    ...(art.ru ? { ru: art.ru } : {}),
    serviceId: localArticleService(art),
    score,
  }));
}

function localArticleService(article: KbArticle): string | null {
  const tags = new Set(article.tags);
  if (tags.has('money-code')) return 'money_code';
  if (tags.has('invoice') || tags.has('billing') || tags.has('statement')) return 'billing';
  if (tags.has('report') || tags.has('transactions')) return 'transactions';
  if (tags.has('delivery') || tags.has('fedex')) return 'tracking';
  if (
    tags.has('card') ||
    tags.has('override') ||
    tags.has('pin') ||
    tags.has('limit') ||
    tags.has('new-card') ||
    tags.has('replace')
  ) {
    return 'cards';
  }
  return null;
}

interface RemoteArticle {
  id: string;
  title: string;
  content: string;
  translations: Record<string, string>;
  serviceId: string | null;
  score: number;
}

function isRemoteArticle(value: unknown): value is RemoteArticle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<RemoteArticle>;
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.content === 'string' &&
    typeof row.score === 'number' &&
    Number.isFinite(row.score) &&
    (row.serviceId === null || typeof row.serviceId === 'string') &&
    Boolean(row.translations) &&
    typeof row.translations === 'object' &&
    !Array.isArray(row.translations)
  );
}

const REMOTE_CACHE_TTL_MS = 5 * 60_000;
const REMOTE_CACHE_MAX = 500;
const remoteCache = new Map<string, { expiresAt: number; hits: KbHit[] }>();
const remoteInflight = new Map<string, Promise<KbHit[]>>();

function trimCache(): void {
  const now = Date.now();
  for (const [key, entry] of remoteCache) {
    if (entry.expiresAt <= now) remoteCache.delete(key);
  }
  while (remoteCache.size > REMOTE_CACHE_MAX) {
    const oldest = remoteCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    remoteCache.delete(oldest);
  }
}

async function fetchRemoteKb(
  carrierId: string,
  query: string,
  enabledServices: string[],
  limit: number,
): Promise<KbHit[]> {
  const response = await fetch(
    `${config.octaneBase}/v1/support-bot/knowledge/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.octaneKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        carrierId,
        query,
        enabledServices,
        limit,
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`support KB HTTP ${response.status}`);
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const articles = (payload as { articles?: unknown }).articles;
  if (!Array.isArray(articles)) return [];
  return articles.filter(isRemoteArticle).slice(0, limit).map((article) => {
    const uz = article.translations['uz'];
    const ru = article.translations['ru'];
    return {
      id: article.id,
      title: article.title,
      en: article.content,
      translations: article.translations,
      serviceId: article.serviceId,
      score: article.score,
      ...(uz ? { uz } : {}),
      ...(ru ? { ru } : {}),
    };
  });
}

/**
 * DB-backed hybrid RAG with bounded cache/single-flight. During migration or backend failure the
 * verified bundled corpus remains a safe fallback, filtered by the same deployment services.
 */
export async function searchSupportKb(
  carrierId: string,
  query: string,
  enabledServices: string[],
  limit = 3,
): Promise<KbHit[]> {
  const normalizedServices = [...new Set(enabledServices)].sort();
  const key = `${carrierId}\n${normalizedServices.join(',')}\n${normalize(query)}`;
  trimCache();
  const cached = remoteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    incrementCounter('kb_cache_hit_total');
    return cached.hits;
  }
  const running = remoteInflight.get(key);
  if (running) {
    incrementCounter('kb_singleflight_hit_total');
    return running;
  }

  const request = fetchRemoteKb(carrierId, query, normalizedServices, limit)
    .then((remoteHits) => {
      remoteCache.set(key, {
        expiresAt: Date.now() + REMOTE_CACHE_TTL_MS,
        hits: remoteHits,
      });
      return remoteHits;
    })
    .catch((error: unknown) => {
      incrementCounter('kb_backend_error_total');
      console.warn(
        '[kb] backend search failed; using bundled corpus',
        error instanceof Error ? error.message : String(error),
      );
      return searchKb(query, limit, new Set(normalizedServices));
    })
    .finally(() => {
      remoteInflight.delete(key);
    });
  remoteInflight.set(key, request);
  return request;
}
