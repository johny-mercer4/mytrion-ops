import { CHUNK_OVERLAP, CHUNK_SIZE } from '../../config/constants.js';

export interface TextChunk {
  index: number;
  content: string;
  /** Heading lineage retained from the source document. */
  sectionPath?: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

// Try to split on progressively finer boundaries so chunks end on natural breaks.
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

interface Section {
  path: string;
  body: string;
}

function isHeading(line: string): boolean {
  const clean = line.trim();
  if (/^#{1,6}\s+\S/.test(clean)) return true;
  // Treat nested section numbers as headings, but keep ordinary `1. Do this` procedures intact.
  if (/^\d+(?:\.\d+)+[.)]?\s+[A-Z\u0400-\u04FF]/.test(clean) && clean.length < 140) return true;
  return clean.length > 2 && clean.length < 100 && /[A-Z\u0400-\u04FF]/.test(clean) && clean === clean.toUpperCase();
}

function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim().slice(0, 300);
}

/** Preserve headings instead of allowing a recursive split to detach a procedure from its title. */
function structuralSections(text: string): Section[] {
  const sections: Section[] = [];
  const headings: string[] = [];
  let body: string[] = [];
  const flush = (): void => {
    const value = body.join('\n').trim();
    if (value) sections.push({ path: headings.join(' > '), body: value });
    body = [];
  };
  for (const line of text.split('\n')) {
    if (isHeading(line)) {
      flush();
      const depth = line.match(/^#+/)?.[0].length ?? 1;
      headings.splice(Math.max(0, depth - 1));
      headings[depth - 1] = headingText(line);
      continue;
    }
    body.push(line);
  }
  flush();
  return sections.length > 0 ? sections : [{ path: '', body: text }];
}

/** Recursively split text into pieces no larger than `size`, preferring clean breaks. */
function recursiveSplit(text: string, size: number, separators: string[]): string[] {
  if (text.length <= size) return text.length > 0 ? [text] : [];

  const [separator, ...rest] = separators;
  if (separator === undefined) {
    // No separators left: hard-slice by size.
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  const parts = separator === '' ? text.split('') : text.split(separator);
  const pieces: string[] = [];
  let buffer = '';
  for (const part of parts) {
    const candidate = buffer.length === 0 ? part : `${buffer}${separator}${part}`;
    if (candidate.length <= size) {
      buffer = candidate;
    } else {
      if (buffer.length > 0) pieces.push(buffer);
      if (part.length > size) {
        pieces.push(...recursiveSplit(part, size, rest));
        buffer = '';
      } else {
        buffer = part;
      }
    }
  }
  if (buffer.length > 0) pieces.push(buffer);
  return pieces;
}

/**
 * Split text into overlapping chunks. Whitespace is normalized at the edges and the
 * tail of each chunk is prepended to the next (`overlap` chars) to preserve context.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = Math.min(options.overlap ?? CHUNK_OVERLAP, Math.floor(chunkSize / 2));
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];

  const chunks: TextChunk[] = [];
  let carry = '';
  /** Sections buffered for the current chunk: small neighbours are packed rather than emitted alone. */
  let pending: Section[] = [];
  let pendingLength = 0;

  const leaf = (path: string): string => path.split(' > ').pop() ?? path;
  /**
   * Render buffered sections. A single section keeps its body verbatim — unchanged behaviour for
   * prose documents. Two or more get their leaf heading inlined, because the model only ever sees
   * `content` in the grounding block (`buildGroundingBlock`) and would otherwise read several
   * sections run together with no idea where one ends.
   */
  const renderPending = (): string =>
    pending.length === 1
      ? (pending[0]?.body ?? '')
      : pending.map((s) => (s.path ? `${leaf(s.path)}\n${s.body}` : s.body)).join('\n\n');
  const pendingPath = (): string => {
    const paths = [...new Set(pending.map((s) => s.path).filter(Boolean))];
    return paths.length <= 1 ? (paths[0] ?? '') : paths.join(' | ');
  };

  const emit = (content: string, sectionPath: string): void => {
    const withCarry = (carry.length > 0 ? `${carry} ${content}` : content).trim();
    if (withCarry.length === 0) return;
    chunks.push({
      index: chunks.length,
      content: withCarry,
      ...(sectionPath ? { sectionPath } : {}),
    });
    carry = overlap > 0 ? withCarry.slice(Math.max(0, withCarry.length - overlap)) : '';
  };

  const flushPending = (): void => {
    if (pending.length === 0) return;
    emit(renderPending(), pendingPath());
    pending = [];
    pendingLength = 0;
  };

  /**
   * Pack consecutive small sections up to `chunkSize`.
   *
   * Previously every section became at least one chunk regardless of size, so a heavily-subheaded
   * document fragmented far below the budget: measured, a 1,778-character generated automation
   * document became **6 chunks averaging 296 characters** against a 1,000-character budget, one per
   * `##` heading. That is why retrieval could return the right document at rank 1 and still not carry
   * the facts — "receives an approximately 30-minute active window" (under Result) and "does not lift
   * the fraud hold" (under Important) could never appear in the same passage. Document recall was
   * 97.9% while evidence coverage sat at 76%.
   */
  for (const section of structuralSections(normalized)) {
    if (section.body.length > chunkSize) {
      // A large section still splits on its own, and must not be glued to buffered neighbours.
      flushPending();
      for (const piece of recursiveSplit(section.body, chunkSize, SEPARATORS)) {
        emit(piece, section.path);
      }
      continue;
    }
    // +2 for the blank line joining sections; leaf headings add a little more, so this stays a
    // conservative estimate of the rendered length.
    const projected = pendingLength === 0 ? section.body.length : pendingLength + 2 + section.body.length;
    if (projected > chunkSize) flushPending();
    pending.push(section);
    pendingLength = pendingLength === 0 ? section.body.length : projected;
  }
  flushPending();
  return chunks;
}

/** Deterministic 50–100-token contextual prefix for embedding and lexical retrieval. */
export function contextualizeChunk(
  chunk: TextChunk,
  doc: { title: string; source?: string; domain?: string; language?: string },
): string {
  const context = [
    `Document: ${doc.title}`,
    chunk.sectionPath ? `Section: ${chunk.sectionPath}` : '',
    doc.domain ? `Knowledge domain: ${doc.domain}` : '',
    doc.language ? `Language: ${doc.language}` : '',
    doc.source ? `Source: ${doc.source}` : '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 400);
  return `${context}.\n\n${chunk.content}`;
}
