import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Read and validate the 32-byte base64 encryption key from env (lazily). */
function getKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new AppError('ENCRYPTION_KEY is not configured', {
      code: 'CONFIG_ERROR',
      statusCode: 500,
    });
  }
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new AppError(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`, {
      code: 'CONFIG_ERROR',
      statusCode: 500,
    });
  }
  return key;
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM. Output is `iv:tag:ciphertext`, each
 * base64. Use for vendor credentials stored at rest.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** Decrypt a value produced by {@link encryptSecret}. Throws on tampering. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new AppError('Malformed ciphertext', { code: 'CRYPTO_ERROR', statusCode: 500 });
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Generate a fresh base64 encryption key suitable for ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/** Constant-time string comparison (for opaque tokens, not passwords). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
