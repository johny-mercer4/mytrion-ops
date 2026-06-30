import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Customer Service Mytrion — tickets, calls, contacts, analytics. Ported from mytrion-customer-service. */
export default function CustomerServiceMytrion() {
  return (
    <MytrionScaffold
      id="customer-service"
      buildNotes={[
        'Ticket/call/contact tables: column defs, picklist colors (CS_PICKLIST_COLORS), DEAL_FIELD_MAP',
        'Modal validation (Vue → Zod schemas)',
        'DWH ticket/call analytics calls',
        'Replace Deluge mytrionGet* functions → servercrm / Zoho Desk REST',
      ]}
    />
  );
}
