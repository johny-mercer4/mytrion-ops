CREATE TABLE IF NOT EXISTS recruit_job_openings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  opening_code text,
  title text NOT NULL,
  department_id text NOT NULL,
  department_name text NOT NULL,
  hiring_manager_employee_id text,
  employment_type text NOT NULL DEFAULT 'full_time',
  location text,
  status text NOT NULL DEFAULT 'draft',
  headcount integer NOT NULL DEFAULT 1,
  description text,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruit_job_openings_status_chk
    CHECK (status IN ('draft', 'open', 'paused', 'closed')),
  CONSTRAINT recruit_job_openings_type_chk
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
  CONSTRAINT recruit_job_openings_headcount_chk CHECK (headcount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS recruit_job_openings_tenant_code_uk
  ON recruit_job_openings (tenant_id, opening_code)
  WHERE opening_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS recruit_job_openings_tenant_status_idx
  ON recruit_job_openings (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS recruit_job_openings_tenant_department_idx
  ON recruit_job_openings (tenant_id, department_id);

CREATE TABLE IF NOT EXISTS recruit_candidates (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  job_opening_id text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  stage text NOT NULL DEFAULT 'new',
  source text,
  current_company text,
  current_title text,
  notes text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  converted_employee_id text,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruit_candidates_stage_chk
    CHECK (stage IN ('new', 'screening', 'interview', 'offer', 'hired', 'rejected'))
);

CREATE INDEX IF NOT EXISTS recruit_candidates_tenant_stage_idx
  ON recruit_candidates (tenant_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS recruit_candidates_tenant_job_idx
  ON recruit_candidates (tenant_id, job_opening_id);
CREATE INDEX IF NOT EXISTS recruit_candidates_tenant_email_idx
  ON recruit_candidates (tenant_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS recruit_candidates_tenant_employee_uk
  ON recruit_candidates (tenant_id, converted_employee_id)
  WHERE converted_employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recruit_settings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  default_location text,
  employee_id_prefix text NOT NULL DEFAULT 'EMP',
  default_employee_status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recruit_settings_tenant_uk
  ON recruit_settings (tenant_id);

-- Make the new workspace visible to existing admin/HR access rows. Explicit non-admin overrides
-- remain untouched; Recruit can still be granted or denied per user from Admin → User Management.
UPDATE mytrion_profile_defaults
SET allowed_mytrions = allowed_mytrions || '["recruit"]'::jsonb,
    updated_at = now()
WHERE (all_department_access = true OR profile_key = 'hr')
  AND NOT (allowed_mytrions ? 'recruit');

UPDATE mytrion_role_defaults
SET allowed_mytrions = allowed_mytrions || '["recruit"]'::jsonb,
    updated_at = now()
WHERE (all_department_access = true OR role_key IN ('hr', 'recruiter'))
  AND NOT (allowed_mytrions ? 'recruit');

UPDATE worker_mytrion_access
SET allowed_mytrions = allowed_mytrions || '["recruit"]'::jsonb,
    updated_at = now()
WHERE all_department_access = true
  AND allowed_mytrions IS NOT NULL
  AND NOT (allowed_mytrions ? 'recruit');
