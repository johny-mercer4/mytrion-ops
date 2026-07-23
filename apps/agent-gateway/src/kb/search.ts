/**
 * KB-2 retrieval — a tiny, dependency-free keyword search over the bundled client-safe corpus
 * (corpus.ts). No embeddings/infra: the corpus is small and curated, so weighted token overlap
 * (title/tags/triggers weigh more than body) ranks well and stays deterministic. The tool returns
 * the top few articles; the model then answers in the client's language and states facts ONLY from
 * the returned text (octane-kb HARD RULE). Pure in-process — no carrier data, no backend round-trip.
 */
import { KB_ARTICLES, type KbArticle } from './corpus.js';

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
  score: number;
}

/** Rank the corpus against a free-text query; return the top `limit` articles (score-descending). */
export function searchKb(query: string, limit = 3): KbHit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const scored = INDEX.map(({ art, title, tagTrig, body }) => {
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
    score,
  }));
}
