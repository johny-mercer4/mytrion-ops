import { CHUNK_OVERLAP, CHUNK_SIZE } from '../../config/constants.js';

export interface TextChunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

// Try to split on progressively finer boundaries so chunks end on natural breaks.
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

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

  const base = recursiveSplit(normalized, chunkSize, SEPARATORS);

  const chunks: TextChunk[] = [];
  let carry = '';
  for (const piece of base) {
    const content = (carry.length > 0 ? `${carry} ${piece}` : piece).trim();
    if (content.length === 0) continue;
    chunks.push({ index: chunks.length, content });
    carry = overlap > 0 ? content.slice(Math.max(0, content.length - overlap)) : '';
  }
  return chunks;
}
