-- 0094: seed the ticket-type / escalation-reason catalog.
--
-- Moves hardcoded frontend arrays into the DB so admins own them:
--   * 49 client ticket types   (sales/redesign/createTicketForms.tsx CR_TYPES)
--   * 11 escalation reasons (sales/redesign/createTicketOtherForms.tsx ESCALATION_REASONS)
--
-- Deliberate choices:
--   * M-* (Maintenance) seeds INACTIVE. Only Customer Service, Billing and Verification are ticket
--     targets and there is no Maintenance Mytrion to work that queue.
--   * default_assignee_zoho_user_id is NULL on EVERY escalation reason. Who a reason falls to is
--     chosen in Mytrion Admin against the HR directory; seeding a guess would silently route real
--     escalations to the wrong person, so an unrouted reason must fail loudly at raise time instead.
--   * requestable is false everywhere. Which subset the lightweight Requests tab offers is an
--     operational decision, not a default.
--   * automation_key stays NULL: the frontend resolves an automation from the type CODE, and `code`
--     is now a clean column rather than a string parsed out of a label.
--
-- Deterministic ids (md5 of tenant + code) so re-running is a genuine no-op.

INSERT INTO mytrion_ticket_types
  (id, tenant_id, code, label, kind, target_department, "group",
   requires_carrier, active, sort_order)
SELECT 'mtty_' || substr(md5(t.id || c.code), 1, 20),
       t.id, c.code, c.label, c.kind, c.target_department, c."group",
       c.requires_carrier, c.active, c.sort_order
  FROM tenants t
 CROSS JOIN (VALUES
  ('C-1', 'Card Activation', 'ticket', 'customer-service', 'Customer Service', true, true, 1),
  ('C-2', 'Application Update', 'ticket', 'customer-service', 'Customer Service', true, true, 2),
  ('C-3', 'Card Deactivation', 'ticket', 'customer-service', 'Customer Service', true, true, 3),
  ('C-4', 'Increase limits', 'ticket', 'customer-service', 'Customer Service', true, true, 4),
  ('C-5', 'Decrease limits', 'ticket', 'customer-service', 'Customer Service', true, true, 5),
  ('C-6', 'Card Replacement', 'ticket', 'customer-service', 'Customer Service', true, true, 6),
  ('C-7', 'Account Reactivation', 'ticket', 'customer-service', 'Customer Service', true, true, 7),
  ('C-8', 'Balance', 'ticket', 'customer-service', 'Customer Service', true, true, 8),
  ('C-10', 'Fraud Hold / Release', 'ticket', 'customer-service', 'Customer Service', true, true, 9),
  ('C-11', 'Mobile app log-in', 'ticket', 'customer-service', 'Customer Service', true, true, 10),
  ('C-12', 'EFS log-in', 'ticket', 'customer-service', 'Customer Service', true, true, 11),
  ('C-14', 'Close the account on WEX', 'ticket', 'customer-service', 'Customer Service', true, true, 12),
  ('C-15', 'Transaction reports', 'ticket', 'customer-service', 'Customer Service', true, true, 13),
  ('C-16', 'Override the card', 'ticket', 'customer-service', 'Customer Service', true, true, 14),
  ('C-17', 'Money Code', 'ticket', 'customer-service', 'Customer Service', true, true, 15),
  ('C-18', 'Checking payments', 'ticket', 'customer-service', 'Customer Service', true, true, 16),
  ('C-19', 'Wex task response', 'ticket', 'customer-service', 'Customer Service', true, true, 17),
  ('C-20', 'Invoice sending', 'ticket', 'customer-service', 'Customer Service', true, true, 18),
  ('C-22', 'Tracking number request', 'ticket', 'customer-service', 'Customer Service', true, true, 19),
  ('C-24', 'Card last used check', 'ticket', 'customer-service', 'Customer Service', true, true, 20),
  ('C-26', 'Unit#/DrID change', 'ticket', 'customer-service', 'Customer Service', true, true, 21),
  ('C-27', 'Boca Sent', 'ticket', 'customer-service', 'Customer Service', true, true, 22),
  ('C-28', 'Account Status Check', 'ticket', 'customer-service', 'Customer Service', true, true, 23),
  ('C-30', 'Other requests', 'ticket', 'customer-service', 'Customer Service', true, true, 24),
  ('Q-1', 'Invoice Request', 'ticket', 'billing', 'Billing & Accounting', true, true, 25),
  ('Q-2', 'Payment Verification', 'ticket', 'billing', 'Billing & Accounting', true, true, 26),
  ('Q-3', 'Payment Date Change / Deferral', 'ticket', 'billing', 'Billing & Accounting', true, true, 27),
  ('Q-4', 'Activate Account Without Payment', 'ticket', 'billing', 'Billing & Accounting', true, true, 28),
  ('Q-5', 'Change Payment Information', 'ticket', 'billing', 'Billing & Accounting', true, true, 29),
  ('Q-6', 'Client Communication (Fees & Invoices)', 'ticket', 'billing', 'Billing & Accounting', true, true, 30),
  ('Q-7', 'Invoice Check / Debt Amount', 'ticket', 'billing', 'Billing & Accounting', true, true, 31),
  ('Q-8', 'Prepaid Balance Check', 'ticket', 'billing', 'Billing & Accounting', true, true, 32),
  ('Q-9', 'Billing Form Verification', 'ticket', 'billing', 'Billing & Accounting', true, true, 33),
  ('Q-10', 'Referrals', 'ticket', 'billing', 'Billing & Accounting', true, true, 34),
  ('V-1', 'Plaid link request', 'ticket', 'verification', 'Verification', true, true, 35),
  ('V-2', 'Plaid check for LOC review', 'ticket', 'verification', 'Verification', true, true, 36),
  ('V-3', 'Extra card request', 'ticket', 'verification', 'Verification', true, true, 37),
  ('V-4', 'Weekly limit review', 'ticket', 'verification', 'Verification', true, true, 38),
  ('V-5', 'Card limit review', 'ticket', 'verification', 'Verification', true, true, 39),
  ('V-6', 'Plaid check for billing cycle', 'ticket', 'verification', 'Verification', true, true, 40),
  ('V-7', 'Verification process update', 'ticket', 'verification', 'Verification', true, true, 41),
  ('V-9', 'Billing Convert', 'ticket', 'verification', 'Verification', true, true, 42),
  ('V-10', 'Plaid Link Send', 'ticket', 'verification', 'Verification', true, true, 43),
  ('V-11', 'Plaid Check', 'ticket', 'verification', 'Verification', true, true, 44),
  ('M-1', 'Tire change', 'ticket', 'maintenance', 'Maintenance', true, false, 45),
  ('M-2', 'Oil change', 'ticket', 'maintenance', 'Maintenance', true, false, 46),
  ('M-3', 'Road Side assistance', 'ticket', 'maintenance', 'Maintenance', true, false, 47),
  ('M-4', 'Mechanical', 'ticket', 'maintenance', 'Maintenance', true, false, 48),
  ('M-5', 'Truck Wash', 'ticket', 'maintenance', 'Maintenance', true, false, 49),
  ('ESC-01', 'Problem with the client', 'escalation_reason', NULL, 'Escalation Reason', false, true, 1),
  ('ESC-02', 'Question', 'escalation_reason', NULL, 'Escalation Reason', false, true, 2),
  ('ESC-03', 'Personal Request', 'escalation_reason', NULL, 'Escalation Reason', false, true, 3),
  ('ESC-04', 'CITI Fuel Duplicate', 'escalation_reason', NULL, 'Escalation Reason', false, true, 4),
  ('ESC-05', 'CRM Question', 'escalation_reason', NULL, 'Escalation Reason', false, true, 5),
  ('ESC-06', 'Lead Transfer', 'escalation_reason', NULL, 'Escalation Reason', false, true, 6),
  ('ESC-07', 'Deal Transfer', 'escalation_reason', NULL, 'Escalation Reason', false, true, 7),
  ('ESC-08', 'Mobile App Issue', 'escalation_reason', NULL, 'Escalation Reason', false, true, 8),
  ('ESC-09', 'RingCentral Number Issue', 'escalation_reason', NULL, 'Escalation Reason', false, true, 9),
  ('ESC-10', 'Additional Discounts', 'escalation_reason', NULL, 'Escalation Reason', false, true, 10),
  ('ESC-11', 'Other', 'escalation_reason', NULL, 'Escalation Reason', false, true, 11)
 ) AS c(code, label, kind, target_department, "group",
        requires_carrier, active, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;
