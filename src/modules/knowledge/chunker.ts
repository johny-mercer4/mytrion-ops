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
  for (const section of structuralSections(normalized)) {
    const base = recursiveSplit(section.body, chunkSize, SEPARATORS);
    for (const piece of base) {
      const content = (carry.length > 0 ? `${carry} ${piece}` : piece).trim();
      if (content.length === 0) continue;
      chunks.push({
        index: chunks.length,
        content,
        ...(section.path ? { sectionPath: section.path } : {}),
      });
      carry = overlap > 0 ? content.slice(Math.max(0, content.length - overlap)) : '';
    }
  }
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
