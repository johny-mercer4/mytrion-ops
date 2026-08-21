-- Collection desk — the rest of the Zoho Collection_Cases surface, so collection agents can leave
-- the CRM. Pairs with servercrm PR #187, which points the finder at this Postgres instead of Zoho.
--
-- HAND-WRITTEN AND IDEMPOTENT, like 0127 and 0131, and for the same reason:
-- `src/db/schema/collection*.ts` is deliberately absent from drizzle.config.ts's schema list,
-- because the meta/ snapshot is stale against several teams' files and `db:generate` would emit
-- their pending drift alongside this.
--
-- ⚠ TIMESTAMP IS DELIBERATE (1787090000004). drizzle applies an entry only when
-- `lastAppliedCreatedAt < folderMillis`, and prod's high-water mark is 1787090000001. Anything
-- numbered below that is silently skipped for ever while `db:migrate` still reports success.
-- Read the mark before numbering the next one.
--
-- WHAT IS *NOT* HERE, on purpose. Zoho carries flat mirrors of things this schema already models
-- relationally — Promise_Status / Promise_to_Pay_Date, Payment_Plan_Created / Payment_Plan_Type /
-- Weekly_Payment_Amount / Next_Payment_Due_Date, First_Contact_Date / Contact_Method /
-- Contact_Result / Total_Contact_Attempts, Last_Activity_Date, Last_Stage_Change_Date,
-- Days_In_Current_Stage. Every one of those is derivable from `collection_promises`,
-- `collection_payment_plans` or `collection_activity`, and storing them too would be a second
-- source of truth that drifts the first time somebody writes one and not the other. They are
-- computed on read instead — see `src/modules/collection/caseDossier.ts`.
--
-- Agency_Fee / Total_Debt_With_Fee / Total_Remaining_Amount are Zoho FORMULA fields and stay
-- computed here too; the rates live in `src/modules/collection/agencyFees.ts`.

-- ── collection_cases: the fields the desk had no home for ────────────────────────────────────
ALTER TABLE collection_cases
  -- Agency handling. `first_collection_agency` already exists; a case can be re-placed with a
  -- second agency (the Blueprint has a "120 days · no payment → pick next agency" transition),
  -- so which agency holds it NOW is its own column.
  ADD COLUMN IF NOT EXISTS current_agency            TEXT,
  ADD COLUMN IF NOT EXISTS second_collection_agency  TEXT,
  ADD COLUMN IF NOT EXISTS caine_weiner_tier         TEXT,
  ADD COLUMN IF NOT EXISTS agency_response_status    TEXT,

  -- Legal escalation.
  ADD COLUMN IF NOT EXISTS legal_action_required     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS court_type                TEXT,
  ADD COLUMN IF NOT EXISTS legal_filing_date         DATE,
  ADD COLUMN IF NOT EXISTS legal_documents_attached  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS court_status              TEXT,

  -- Locating the debtor, and the contact details a collector has actually confirmed. Kept apart
  -- from the `debtor_*` block on purpose: those are finder-owned and overwritten every 30
  -- minutes from the Deal, these are what a human verified on a call.
  ADD COLUMN IF NOT EXISTS skip_trace_required       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_email            TEXT,
  ADD COLUMN IF NOT EXISTS verified_phone            TEXT,
  ADD COLUMN IF NOT EXISTS verified_address          TEXT,

  -- Escalation to a manager.
  ADD COLUMN IF NOT EXISTS escalation_required       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalation_date           DATE,

  -- How the case ended, beyond the machine's `closed_reason`.
  ADD COLUMN IF NOT EXISTS cooperation_status        TEXT,
  ADD COLUMN IF NOT EXISTS loss_reason               TEXT,
  ADD COLUMN IF NOT EXISTS payment_received          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_received_date     DATE,

  -- Flags the finder sets at creation, and the running cost of chasing this debt.
  ADD COLUMN IF NOT EXISTS reminder_cycle_active     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS early_bad_debtor_flag     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_cost_incurred       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_merchant_fee        NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Who owns the case. `assignee_user_id` already exists but nothing ever wrote it; the name is
  -- the display copy so a list does not need a join to render a row.
  ADD COLUMN IF NOT EXISTS assignee_name             TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at               TIMESTAMPTZ;

-- Backfill `current_agency` from the placement already on the row, so a case that was placed
-- before this migration does not read as unplaced.
UPDATE collection_cases
   SET current_agency = first_collection_agency
 WHERE current_agency IS NULL
   AND first_collection_agency IS NOT NULL;

CREATE INDEX IF NOT EXISTS collection_cases_assignee_idx
  ON collection_cases (assignee_user_id, status);
CREATE INDEX IF NOT EXISTS collection_cases_current_agency_idx
  ON collection_cases (current_agency)
  WHERE current_agency IS NOT NULL;

-- ── collection_tasks — the follow-ups Zoho kept in its Tasks related list ─────────────────────
-- A worklist tells a collector which cases need attention today; a task is the reminder THEY set
-- for a specific case on a specific day. Separate concerns, so a separate table rather than
-- another `collection_activity` kind: activity is an immutable log, a task is mutable state that
-- opens, gets rescheduled, and closes.
CREATE TABLE IF NOT EXISTS collection_tasks (
  id                TEXT         PRIMARY KEY,
  case_id           TEXT         NOT NULL REFERENCES collection_cases (id) ON DELETE CASCADE,
  title             TEXT         NOT NULL,
  note              TEXT,
  due_date          DATE         NOT NULL,
  status            TEXT         NOT NULL DEFAULT 'open',
  priority          TEXT         NOT NULL DEFAULT 'normal',
  assignee_user_id  TEXT,
  assignee_name     TEXT,
  completed_at      TIMESTAMPTZ,
  completed_by_id   TEXT,
  created_by_id     TEXT,
  created_by_name   TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_tasks_case_idx    ON collection_tasks (case_id, due_date);
CREATE INDEX IF NOT EXISTS collection_tasks_open_idx    ON collection_tasks (status, due_date)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS collection_tasks_assignee_idx ON collection_tasks (assignee_user_id, status);

-- ── collection_case_attachments — the agency letters, court filings, USPS proofs ──────────────
-- Same shape and the same seam as `maintenance_case_attachments`: bytes live in R2 or Dropbox
-- via `src/modules/files/storage/`, this table is metadata plus the key. `storage_provider` is
-- per-row, not a global setting, so rows written before a default flips keep resolving.
CREATE TABLE IF NOT EXISTS collection_case_attachments (
  id                  TEXT         PRIMARY KEY,
  case_id             TEXT         NOT NULL REFERENCES collection_cases (id) ON DELETE CASCADE,
  file_name           TEXT         NOT NULL,
  mime                TEXT         NOT NULL,
  size_bytes          INTEGER      NOT NULL,
  s3_key              TEXT         NOT NULL,
  storage_provider    TEXT         NOT NULL DEFAULT 's3',
  kind                TEXT,
  uploaded_by_user_id TEXT,
  uploaded_by_name    TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_case_attachments_case_idx
  ON collection_case_attachments (case_id, created_at);
