import type { Readable } from 'node:stream';

/**
 * Object-storage abstraction: MinIO today, any S3-compatible store (R2) tomorrow — the
 * implementation is chosen by env, callers never see the SDK.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  getStream(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }>;
  /** Bounded read for parse paths — rejects objects larger than maxBytes (memory guardrail). */
  getBuffer(key: string, maxBytes: number): Promise<Buffer>;
  presignGet(key: string, opts?: { ttlSeconds?: number; filename?: string }): Promise<{
    url: string;
    expiresAt: Date;
  }>;
  delete(key: string): Promise<void>;
}
