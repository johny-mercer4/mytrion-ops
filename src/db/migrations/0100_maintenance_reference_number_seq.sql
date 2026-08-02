-- Reference Number auto-generation (CS Mytrion Maintenance feedback, 2026-07-31).
-- Historical values (migrated from Zoho) range 1..400,826,792 with no discernible sequence —
-- manually-entered shop/work-order numbers, not a system series. This sequence is a FRESH
-- internal series for cases created in Mytrion going forward, seeded well clear of the
-- historical range so a generated number can never collide with a legacy manually-entered one.
CREATE SEQUENCE IF NOT EXISTS maintenance_reference_number_seq START WITH 500000000;
