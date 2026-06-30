import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Sales Mytrion — pipeline/operations dashboard. Ported from self-service (the heaviest port). */
export default function SalesMytrion() {
  return (
    <MytrionScaffold
      id="sales"
      buildNotes={[
        'Home: workday progress, announcements feed (WebSocket), AI briefing, recent inbox',
        'Inbox: real-time notifications (reconnecting WS), unread badge, filters, mark-read/dismiss',
        'Records/Data Center: agent clients → servercrm /api/clients/by-agent, invoices, payments, carrier balance',
        'Create: ticket / escalation (+attachment) / maintenance / lead-from-carrier-search',
        'Automations: balance check, card activate/replace, EFS limits, BOCA/BOE (browser-automation svc)',
        'Dashboard: agent metrics + leaderboard → servercrm /api/agent/activity',
        'Admin "View as" impersonation picker (gate via access config, not client-trusted)',
      ]}
    />
  );
}
