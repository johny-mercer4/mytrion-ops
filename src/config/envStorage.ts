import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((value) => value === '1' || value.toLowerCase() === 'true');

/**
 * File storage — Cloudflare R2, MinIO and Dropbox, plus the parse-path memory guardrail.
 *
 * Split out of `env.ts` for the 600-line cap. R2 and MinIO are both S3-compatible and swap by env
 * alone; Dropbox is its own thing and carries the comms/verification roots.
 */
export const storageEnvShape = {
  // --- File storage: Cloudflare R2 (S3-compatible) ---
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  // Defaults to https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com when blank.
  R2_ENDPOINT: z.string().default(''),
  // Optional public/custom-domain base for serving uploaded files.
  R2_PUBLIC_BASE_URL: z.string().default(''),
  // R2 ignores region but the S3 SDK requires one; 'auto' is correct for R2.
  R2_REGION: z.string().default('auto'),

  // --- File storage: MinIO (self-hosted, S3-compatible). R2 swaps in later via env only:
  // set S3_ENDPOINT to the R2 endpoint, S3_REGION=auto, S3_FORCE_PATH_STYLE=0.
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  // MinIO requires path-style addressing (bucket in the path, not the host).
  S3_FORCE_PATH_STYLE: flag('1'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(900),
  // Hard cap for uploads AND generated artifacts.
  FILE_MAX_SIZE_MB: z.coerce.number().int().positive().max(200).default(25),

  // --- Dropbox: storage for comms chat attachments and the general file pipeline ---
  //
  // Which provider a NEW comms attachment lands on. Per-provider rather than global because every
  // existing file_assets row is on S3 and must keep resolving there — the row records its own provider, so
  // flipping this only changes where the next upload goes.
  COMMS_STORAGE_PROVIDER: z.enum(['s3', 'dropbox']).default('s3'),
  // Where a NEW file in the GENERAL pipeline lands: `POST /v1/files/upload` (import) and every generated
  // artifact (file.generate_csv / _excel / _pdf export). Separate from COMMS_STORAGE_PROVIDER so chat
  // attachments and business documents can live in different stores — a customer's chat file and an
  // internal revenue export are not the same retention problem.
  //
  // Safe to flip at any time: `storeFile` records the resolved provider on the `file_assets` row and every
  // read/delete goes back through `storageFor(row.storageProvider)`, so files already written stay
  // readable wherever they are. It does NOT retroactively move anything.
  //
  // This deliberately does NOT govern `getStorage()` — see the note in modules/files/storage/index.ts.
  FILE_STORAGE_PROVIDER: z.enum(['s3', 'dropbox']).default('s3'),
  // Refresh-token grant. Dropbox access tokens last ~4h, so the refresh token is the durable credential;
  // there is no place to persist a rotated one, which is why rotation must stay off on the Dropbox app.
  DROPBOX_APP_KEY: z.string().default(''),
  DROPBOX_APP_SECRET: z.string().default(''),
  DROPBOX_REFRESH_TOKEN: z.string().default(''),
  // Folder prefix inside the Dropbox app folder. Tenant and thread are appended, so one Dropbox app can
  // serve every tenant without their files interleaving.
  DROPBOX_ROOT_PATH: z.string().default('/comms'),
  // Which provider a NEW Maintenance attachment lands on. Separate from COMMS_STORAGE_PROVIDER because
  // Maintenance attachments are a distinct table (maintenance_case_attachments), not file_assets.
  MAINTENANCE_STORAGE_PROVIDER: z.enum(['s3', 'dropbox_maintenance']).default('s3'),
  // Maintenance gets its OWN Dropbox folder, not DROPBOX_ROOT_PATH (CS feedback 2026-08-06: don't dump
  // every service into one shared folder) — same app key/secret/refresh token, different root prefix.
  DROPBOX_MAINTENANCE_ROOT_PATH: z.string().default('/maintenance'),
  // Which provider a NEW Verification applicant document lands on. Defaults to Dropbox, unlike comms
  // and Maintenance: verification_case_documents is a new table with no pre-existing S3 rows, so there
  // are no reads a Dropbox default could repoint at bytes that are not there.
  VERIFICATION_STORAGE_PROVIDER: z.enum(['s3', 'dropbox_verification']).default('dropbox_verification'),
  // Verification's own Dropbox folder — bank statements, SSN cards, licences, lease agreements. Kept
  // separate so the later LLM underwriting review has one addressable root, and so applicant PII never
  // lands in the comms or Maintenance folder.
  DROPBOX_VERIFICATION_ROOT_PATH: z.string().default('/verification'),
  /** Employee photos and HR documents — their own folder, never mixed into `/comms`. */
  DROPBOX_HR_ROOT_PATH: z.string().default('/hr'),
  HR_STORAGE_PROVIDER: z.enum(['s3', 'dropbox_hr']).default('dropbox_hr'),
  /** Candidate resumes — their own Recruit folder (per-candidate subfolders), never mixed into `/hr`. */
  DROPBOX_RECRUIT_ROOT_PATH: z.string().default('/recruit'),
  RECRUIT_STORAGE_PROVIDER: z.enum(['s3', 'dropbox_recruit']).default('dropbox_recruit'),
  // Attachment ceiling, SEPARATE from FILE_MAX_SIZE_MB — that one is zod-capped at 200MB (and the global
  // @fastify/multipart limit is derived from it), while a chat attachment on Dropbox can legitimately be
  // larger. Capped at 2GB because beyond that a buffered upload is the wrong design, not a bigger number.
  COMMS_ATTACHMENT_MAX_MB: z.coerce.number().int().positive().max(2048).default(50),
  // Parse-path memory guardrail (Render starter plan): max bytes loaded for file analysis.
  PARSE_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
};
