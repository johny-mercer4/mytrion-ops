/**
 * S3-compatible ObjectStorage (MinIO: forcePathStyle=1; Cloudflare R2: endpoint+region swap).
 * One lazy client; keys are always tenant-prefixed by the fileService.
 */
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/errors.js';
import type { ObjectStorage } from './types.js';

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export const s3Storage: ObjectStorage = {
  async put(key, body, opts) {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: body.length,
      }),
    );
  },

  async getStream(key) {
    const res = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body || !(res.Body instanceof Readable)) {
      throw new AppError('Object body is not a readable stream', { statusCode: 502, code: 'STORAGE_ERROR' });
    }
    return {
      body: res.Body,
      ...(res.ContentType ? { contentType: res.ContentType } : {}),
      ...(res.ContentLength !== undefined ? { contentLength: res.ContentLength } : {}),
    };
  },

  async getBuffer(key, maxBytes) {
    const head = await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if ((head.ContentLength ?? 0) > maxBytes) {
      throw new AppError(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB parse limit`, {
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
      });
    }
    const { body } = await this.getStream(key);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buf.length;
      if (total > maxBytes) {
        body.destroy();
        throw new AppError('File stream exceeded the parse limit', { statusCode: 413, code: 'FILE_TOO_LARGE' });
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  },

  async presignGet(key, opts = {}) {
    const ttl = opts.ttlSeconds ?? env.S3_PRESIGN_TTL_SECONDS;
    const url = await getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ...(opts.filename
          ? { ResponseContentDisposition: `attachment; filename="${opts.filename.replace(/"/g, '')}"` }
          : {}),
      }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  },

  async delete(key) {
    await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },
};
