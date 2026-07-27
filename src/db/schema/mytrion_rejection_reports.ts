import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), so each schema file loads standalone under drizzle-kit.

/**
 * mytrion_rejection_reports — our own record of every card-decline ("rejection report") that the
 * Zoho Desk Deluge automation turns into a ticket.
 *
 * Today the Sales Data Center reads rejections back out of Zoho, which means the list is only ever
 * as good as a Desk search and carries no ownership of its own. This table is written at the moment
 * of ticket creation (the Deluge posts to `POST /v1/rejection-reports/webhook` right after
 * `zoho.desk.create`), so a decline is durable here even if the Desk write is later edited, and it
 * can be scoped to ONE agent rather than re-derived per read.
 *
 * Ownership: a decline arrives with a `carrier_id`, not an agent. The webhook resolves the owning
 * Sales agent from the DWH carrier→agent mapping and stores BOTH `agent_zoho_user_id` and
 * `agent_name`, because those two do not reliably agree — `dim_company.agent_zoho_user_id` is often
 * unset/mismatched against a worker's session Zoho id, and the name is the only join that returns
 * rows for every agent (the same fallback the Clients roster needs). Reads match on the id when we
 * have it and fall back to the name, so a report is never orphaned by that mismatch alone. Both stay
 * nullable: an unresolvable carrier must still be recorded, not dropped — it surfaces as unassigned.
 *
 * Fields mirror the Deluge's `ticketDescription` block plus the branch flags it computes, so the row
 * explains WHY a given SMS went out without re-running the automation's logic.
 */
export const mytrionRejectionReports = pgTable(
  'mytrion_rejection_reports',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mrr_${createId()}`),
    tenantId: text('tenant_id').notNull(),

    /** Zoho Desk ticket id returned by `zoho.desk.create` — the idempotency key for retries. */
    zohoTicketId: text('zoho_ticket_id'),

    // ---- The decline itself (EFS error payload the automation received) ----
    /** EFS decline code: 12 entry-mode, 17 PIN/unit, 18 item, 25 limit, 3 fraud, 787 balance. */
    errorCode: text('error_code').notNull(),
    errorDescription: text('error_description'),
    /** DWH/CMP carrier id — the ownership key, and how the UI groups a client's declines. */
    carrierId: text('carrier_id').notNull(),
    /** CRM application id when the payload carries one — the Clients search already offers "app ID". */
    applicationId: text('application_id'),
    companyName: text('company_name'),
    /**
     * Fleet card number as the automation received it. Stored because the existing Desk ticket
     * already carries it verbatim (`cf_card_number`) and agents match declines by card — but it is
     * never written to logs or audit detail; `redactParams`-style masking applies at those edges,
     * and `card_last4` exists so the UI can display without reading the full value.
     */
    cardNumber: text('card_number'),
    cardLast4: text('card_last4'),
    driverName: text('driver_name'),
    driverId: text('driver_id'),
    unitNumber: text('unit_number'),
    locationName: text('location_name'),
    locationCity: text('location_city'),
    locationState: text('location_state'),
    stationName: text('station_name'),

    // ---- Branch flags the Deluge computed, kept so the chosen SMS is explainable ----
    /** Location matched the in-network chain list (Love's, TA/Petro, Caseys, …). */
    isNetwork: boolean('is_network').notNull().default(false),
    /** errorDescription contained "Fraud Decline". */
    isFraud: boolean('is_fraud').notNull().default(false),
    /** CRM Deal `Payment_Type_Billing` — drives the 787 (balance) message split. */
    paymentType: text('payment_type'),
    /** The SMS text the automation sent to the driver (`cf_automated_response_to_driver`). */
    automatedResponse: text('automated_response'),

    // ---- Ownership (see the header note on why both are stored) ----
    agentZohoUserId: text('agent_zoho_user_id'),
    agentName: text('agent_name'),
    /** Which arm resolved the owner — kept so an unassigned feed is diagnosable without re-querying. */
    ownerSource: text('owner_source').$type<'dim_company' | 'zoho_deal' | 'unresolved'>()
      .notNull()
      .default('unresolved'),

    /** Agent workflow state: new → acknowledged → resolved. Free text, not a pgEnum, so adding a
     *  step later does not need an ALTER TYPE (matches the retention status-lookup convention). */
    status: text('status').notNull().default('new'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledByZohoUserId: text('handled_by_zoho_user_id'),

    /** When the decline happened at source (the automation's `Created Time`), not when we stored it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** The agent's own feed — the primary read. */
    agentIdx: index('mytrion_rejection_reports_tenant_agent_idx').on(
      table.tenantId,
      table.agentZohoUserId,
      table.occurredAt,
    ),
    /** Name-keyed twin of the above, for the id-mismatch fallback path. */
    agentNameIdx: index('mytrion_rejection_reports_tenant_agent_name_idx').on(
      table.tenantId,
      table.agentName,
      table.occurredAt,
    ),
    /** A client's decline history (carrier drilldown). */
    carrierIdx: index('mytrion_rejection_reports_tenant_carrier_idx').on(
      table.tenantId,
      table.carrierId,
      table.occurredAt,
    ),
    /** Triage by decline type across the book. */
    errorIdx: index('mytrion_rejection_reports_tenant_error_idx').on(
      table.tenantId,
      table.errorCode,
    ),
    /** Idempotent Deluge retries: at most one row per (tenant, ticket) when the id is present. */
    ticketUnique: uniqueIndex('mytrion_rejection_reports_tenant_ticket_uk')
      .on(table.tenantId, table.zohoTicketId)
      .where(sql`${table.zohoTicketId} IS NOT NULL`),
  }),
);

export type MytrionRejectionReport = typeof mytrionRejectionReports.$inferSelect;
export type NewMytrionRejectionReport = typeof mytrionRejectionReports.$inferInsert;
