-- Marketing Mytrion — Referral Program + Loyalty Program, migrated out of the Manager hub.
--
-- No schema change: allowed_mytrions / denied_mytrions are jsonb and home_mytrion is plain text,
-- with no enum and no CHECK constraint, so a new MytrionId needs no DDL.
--
-- This migration exists for a different reason. Access grants are stored per row, so without it
-- EVERY EXISTING MANAGER LOSES A WORKING FEATURE the moment this deploys: Referrals and Loyalty stop
-- being reachable from Manager and their own row does not yet name Marketing. The predicate is
-- therefore wider than 0083_recruit_workspace.sql's (which only had to seed a brand-new workspace) —
-- anyone who holds `manager` today is someone who could open these two tabs yesterday.
--
-- Explicit non-admin overrides are otherwise untouched; Marketing can still be granted or denied per
-- user from Admin → User Management.

UPDATE mytrion_profile_defaults
SET allowed_mytrions = allowed_mytrions || '["marketing"]'::jsonb,
    updated_at = now()
WHERE (all_department_access = true
       OR allowed_mytrions ? 'manager'
       OR profile_key IN ('manager', 'marketing'))
  AND NOT (allowed_mytrions ? 'marketing');

UPDATE mytrion_role_defaults
SET allowed_mytrions = allowed_mytrions || '["marketing"]'::jsonb,
    updated_at = now()
WHERE (all_department_access = true
       OR allowed_mytrions ? 'manager'
       OR role_key IN ('manager', 'marketing'))
  AND allowed_mytrions IS NOT NULL
  AND NOT (allowed_mytrions ? 'marketing');

UPDATE worker_mytrion_access
SET allowed_mytrions = allowed_mytrions || '["marketing"]'::jsonb,
    updated_at = now()
WHERE (all_department_access = true OR allowed_mytrions ? 'manager')
  AND allowed_mytrions IS NOT NULL
  AND NOT (allowed_mytrions ? 'marketing');

-- Carry the read/full MODE across too, which 0083 had no reason to do.
--
-- `requireMytrionWrite(request, 'marketing', …)` gates the loyalty-override writes on
-- mytrion_access_modes->>'marketing'. An omitted key means FULL (see resolveModes), so copying only
-- the grant above and not the mode would silently PROMOTE every read-only manager into someone who
-- can rewrite a carrier's loyalty tier.
UPDATE worker_mytrion_access
SET mytrion_access_modes =
      mytrion_access_modes || jsonb_build_object('marketing', mytrion_access_modes->>'manager'),
    updated_at = now()
WHERE mytrion_access_modes ? 'manager'
  AND NOT (mytrion_access_modes ? 'marketing');

UPDATE mytrion_role_defaults
SET mytrion_access_modes =
      mytrion_access_modes || jsonb_build_object('marketing', mytrion_access_modes->>'manager'),
    updated_at = now()
WHERE mytrion_access_modes ? 'manager'
  AND NOT (mytrion_access_modes ? 'marketing');

-- Carry the DENY across too.
--
-- `denied_mytrions` is the only way an admin can say "all access EXCEPT Manager" — UserAccessForm
-- writes exactly that shape (allowed_mytrions NULL + all_department_access true + a deny). The
-- grant/mode statements above would hand such a worker the Referral and Loyalty programs they were
-- specifically refused, with FULL write on the loyalty overrides, because `marketing` is a new id
-- that their existing deny list cannot name.
--
-- Deliberately NOT symmetric with the grants: a deny is a decision about these two programs, so it
-- follows them. A grant is a decision about the Manager workspace, which is why the grant statements
-- above are the widened-predicate ones.
UPDATE worker_mytrion_access
SET denied_mytrions = denied_mytrions || '["marketing"]'::jsonb,
    updated_at = now()
WHERE denied_mytrions ? 'manager'
  AND NOT (denied_mytrions ? 'marketing');
