import { platformDocument, type PlatformCatalogDocument } from './platformDocument.js';

export interface SalesAutomationKnowledge {
  id: string;
  title: string;
  codes: readonly string[];
  purpose: string;
  prerequisites: readonly string[];
  steps: readonly string[];
  outcome: readonly string[];
  cautions?: readonly string[];
}

/**
 * Governed mirror of the live Sales Mytrion AUTO_LIST. A parity test reads the frontend source and
 * fails when ids, titles, or service codes drift, forcing this explanatory layer to stay current.
 */
export const SALES_AUTOMATION_KNOWLEDGE: readonly SalesAutomationKnowledge[] = [
  {
    id: 'invoices',
    title: 'Request Invoices',
    codes: ['C-20', 'Q-1'],
    purpose: 'Fetch carrier invoices for a date range and download them from WorkDrive.',
    prerequisites: ['A client', 'A preset or custom date range', 'Optional PAID or PENDING status'],
    steps: [
      'Select the client.',
      'Choose the date range and optional invoice status.',
      'For a custom range, enter both From and To dates.',
      'Run Request Invoices.',
    ],
    outcome: ['Review the invoice result, then download PDF and/or Excel.'],
  },
  {
    id: 'transactions',
    title: 'Transactions Report',
    codes: ['C-15'],
    purpose: 'Build a carrier fuel-transaction report for a preset or custom window.',
    prerequisites: ['A client', 'A preset or complete custom date range'],
    steps: [
      'Select the client.',
      'Choose the reporting window.',
      'If Custom is selected, enter both dates.',
      'Run Transactions Report.',
    ],
    outcome: ['Review the formatted report and use its available download action.'],
  },
  {
    id: 'view-manage-cards',
    title: 'Card Status Report',
    codes: ['C-30'],
    purpose: 'View the live EFS card roster for a carrier.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Get Report.'],
    outcome: ['Review card number, unit, driver, status and override data; export PDF or Excel.'],
  },
  {
    id: 'payments',
    title: 'Check Payment Information',
    codes: ['C-18', 'Q-2'],
    purpose: 'View recent carrier invoices and payments.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Check Payments.'],
    outcome: [
      'Review billed, paid, open-balance and payment totals plus available CMP invoice rows for the last 90 days.',
    ],
    cautions: [
      'The DWH summary and CMP invoice source load independently; one may be shown when the other is unavailable.',
    ],
  },
  {
    id: 'billing-form',
    title: 'Billing Forms',
    codes: ['Q-9'],
    purpose: 'View submitted billing forms and verification notes for a deal.',
    prerequisites: ['A client/deal'],
    steps: ['Select the client/deal.', 'Click Fetch Billing Form.'],
    outcome: ['Review the returned form table or the explicit no-form result.'],
  },
  {
    id: 'balance',
    title: 'Balance Check',
    codes: ['C-8', 'Q-8'],
    purpose: 'Check a carrier’s current available balance and credit line.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Check Balance.'],
    outcome: ['Review the live DWH balance and credit-line result.'],
  },
  {
    id: 'account-status',
    title: 'Account Status Check',
    codes: ['Q-7', 'C-28'],
    purpose: 'Check EFS balance, outstanding debt and card counts together.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Check Status.'],
    outcome: ['Review the combined account-status summary.'],
  },
  {
    id: 'tracking',
    title: 'Tracking Number Request',
    codes: ['C-22'],
    purpose: 'Find card-order tracking numbers and shipment status.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Get Tracking.'],
    outcome: ['Review tracking entries and open the shipment-status link when one is supplied.'],
  },
  {
    id: 'card-last-used',
    title: 'Card Last Used Check',
    codes: ['C-24'],
    purpose: 'See when each card on a carrier account was last used.',
    prerequisites: ['A client'],
    steps: ['Select the client.', 'Click Check Last Used.'],
    outcome: [
      'Review the merged live-card and DWH last-use rows, including days since use when known.',
    ],
  },
  {
    id: 'card-activation',
    title: 'Card Activation',
    codes: ['C-1'],
    purpose: 'Activate an EFS card and optionally update its driver/unit prompts.',
    prerequisites: ['A client', 'A card from that client’s live card list'],
    steps: [
      'Select the client.',
      'Select the card to activate.',
      'Optionally enter driver name, unit number and driver ID; current EFS values are prefilled when available.',
      'Click Activate Card and keep the modal open until confirmation.',
    ],
    outcome: [
      'The card is activated immediately; optional card-information changes run after activation and the result reports each operation.',
    ],
    cautions: [
      'Do not claim Horizon itself activated the card. This is a Sales Mytrion write workflow.',
    ],
  },
  {
    id: 'card-deactivation',
    title: 'Card Deactivation',
    codes: ['C-3'],
    purpose: 'Deactivate an EFS card immediately.',
    prerequisites: ['A client', 'A card from that client’s live card list'],
    steps: [
      'Select the client.',
      'Select the card.',
      'Click Deactivate Card and wait for confirmation.',
    ],
    outcome: ['The confirmed EFS status is displayed.'],
  },
  {
    id: 'limits-change',
    title: 'Increase / Decrease Limits',
    codes: ['C-4', 'C-5'],
    purpose: 'Increase or decrease an EFS product limit on a card.',
    prerequisites: [
      'A client',
      'A card',
      'Product: ULSD, DEF, RFR or DSL',
      'Direction and a positive gallon amount no greater than 350',
    ],
    steps: [
      'Select the client and card.',
      'Choose the product limit.',
      'Choose Increase or Decrease.',
      'Enter the change amount, then click Update Limit.',
    ],
    outcome: ['Review the previous limit, applied delta and confirmed new limit.'],
    cautions: ['The maximum change per run is 350 gallons.'],
  },
  {
    id: 'unit-driver',
    title: 'Unit / Driver Change',
    codes: ['C-26'],
    purpose: 'Update driver name, unit number and/or driver ID prompts on a card.',
    prerequisites: ['A client', 'A card', 'At least one field to change'],
    steps: [
      'Select the client and card.',
      'Review the prefilled current values.',
      'Edit one or more fields.',
      'Click Submit Change.',
    ],
    outcome: ['The updated EFS card information is confirmed.'],
  },
  {
    id: 'fraud-hold-release',
    title: 'Fraud Hold / Release',
    codes: ['C-10'],
    purpose:
      'Request release of a fraud-held card after confirming the swipe pattern is legitimate.',
    prerequisites: [
      'A client',
      'A card currently marked with fraud status',
      'The signed-in agent email',
    ],
    steps: [
      'Select the client.',
      'Choose the fraud-held card shown in the filtered list.',
      'Confirm the release request and click Release Hold.',
    ],
    outcome: ['The fraud team receives the request and replies to the agent email.'],
    cautions: [
      'This submits a release request; it does not promise that the hold is already cleared.',
    ],
  },
  {
    id: 'override-card',
    title: 'Override the Card',
    codes: ['C-16'],
    purpose: 'Give a fraud-held card a temporary active window without removing its hold.',
    prerequisites: ['A client', 'A card currently marked with fraud status'],
    steps: ['Select the client.', 'Choose the fraud-held card.', 'Click Override Card.'],
    outcome: ['The card receives an approximately 30-minute active window.'],
    cautions: ['An override does not lift the fraud hold.'],
  },
  {
    id: 'card-replacement',
    title: 'Card Replacement',
    codes: ['C-6'],
    purpose: 'Request replacement cards through the service email workflow.',
    prerequisites: [
      'A client',
      'Complete shipping address: street, city, state and ZIP',
      'The signed-in agent email',
    ],
    steps: [
      'Select the client.',
      'Enter and verify the full shipping address.',
      'Click Request Replacement.',
    ],
    outcome: ['A Zapier-backed request is sent; follow the response sent to the agent email.'],
  },
  {
    id: 'reactivation',
    title: 'Account Reactivation',
    codes: ['C-7'],
    purpose: 'Request reactivation of a suspended or inactive account.',
    prerequisites: ['A client', 'The signed-in agent email'],
    steps: ['Select the client.', 'Confirm the request.', 'Click Request Reactivation.'],
    outcome: ['A Zapier-backed request is sent; the agent receives the team response by email.'],
  },
  {
    id: 'money-code',
    title: 'Money Code',
    codes: ['C-17'],
    purpose: 'Check eligibility and draw an emergency EFS money code for a stranded driver.',
    prerequisites: [
      'A client',
      'A successful live eligibility preview',
      'Amount',
      'Unit number',
      'A reason from the server-provided list',
    ],
    steps: [
      'Select the client and wait for the eligibility preview.',
      'If eligible, enter amount and unit number.',
      'Choose the exact reason offered by the form.',
      'Click Draw Money Code.',
    ],
    outcome: ['The code is delivered to the carrier app.'],
    cautions: [
      'The money code is intentionally never displayed in Sales Mytrion.',
      'Do not bypass a failed eligibility check or invent a reason label.',
    ],
  },
  {
    id: 'boca-boe-link',
    title: 'BOCA Link Request',
    codes: ['C-27'],
    purpose: 'Send a BOCA onboarding task in WEX through guarded browser automation.',
    prerequisites: [
      'A client/deal with a WEX application ID',
      'A passing live eligibility check',
      'Application owner and requested priority/details',
    ],
    steps: [
      'Select the client/deal.',
      'Verify the application ID and owner loaded by the form.',
      'Complete the request fields.',
      'Click Send BOCA and keep the modal open.',
    ],
    outcome: ['The browser job is queued; completion/status is surfaced through Mytrion Inbox.'],
  },
  {
    id: 'close-app',
    title: 'Close Application',
    codes: ['C-14'],
    purpose: 'Close a WEX application that is no longer moving forward.',
    prerequisites: [
      'A client/deal with a WEX application ID',
      'A passing live eligibility check',
      'Application owner and closure details',
    ],
    steps: [
      'Select the client/deal.',
      'Verify the application ID and owner.',
      'Complete the required closure fields.',
      'Click Close Application and keep the modal open.',
    ],
    outcome: ['Guarded browser automation performs the close and returns its result.'],
  },
  {
    id: 'wex-tasks',
    title: 'Application Update — WEX Tasks',
    codes: ['C-2', 'C-19'],
    purpose: 'Read WEX application updates and task responses for a deal.',
    prerequisites: ['A client/deal with a WEX application ID'],
    steps: ['Select the client/deal.', 'Click Get WEX Tasks.'],
    outcome: ['Review the application summary and latest WEX task entries.'],
  },
  {
    id: 'wex-apps',
    title: 'WEX Applications',
    codes: ['C-29'],
    purpose: 'Search WEX applications by applicant details.',
    prerequisites: ['Applicant name, company, MC, DOT, email, phone or application ID'],
    steps: [
      'Open the automation block.',
      'Enter one or more applicant search fields.',
      'Run the search and refine broad results as needed.',
    ],
    outcome: ['Review matching application company, ID, contact, status and group data.'],
  },
  {
    id: 'efs-login',
    title: 'EFS Login',
    codes: ['C-12'],
    purpose: 'Open the official WEX EFS eManager credentials guide.',
    prerequisites: [],
    steps: ['Open the automation block.', 'Click Open Guide.'],
    outcome: ['The official EFS eManager credentials-guide PDF opens.'],
    cautions: ['The knowledge document never stores or exposes credentials.'],
  },
] as const;

function renderAutomation(entry: SalesAutomationKnowledge): string {
  const items = (values: readonly string[]): string[] =>
    values.map((value, index) => `${index + 1}. ${value}`);
  return [
    `# Sales Mytrion Automation — ${entry.title}`,
    '',
    `Automation ID: ${entry.id}`,
    `Service code(s): ${entry.codes.join(', ')}`,
    `Purpose: ${entry.purpose}`,
    '',
    '## Where to find it',
    '1. Open Sales Mytrion.',
    '2. Select Automations in the sidebar.',
    `3. Search for “${entry.title}”, ${entry.codes.join(' or ')}, or a matching keyword.`,
    `4. Click the ${entry.title} block.`,
    '',
    '## Required before running',
    ...(entry.prerequisites.length > 0
      ? entry.prerequisites.map((item) => `- ${item}`)
      : ['- No client selection is required.']),
    '',
    '## Run steps',
    ...items(entry.steps),
    '',
    '## Result',
    ...entry.outcome.map((item) => `- ${item}`),
    ...(entry.cautions?.length
      ? ['', '## Important', ...entry.cautions.map((item) => `- ${item}`)]
      : []),
    '',
    'Horizon can explain this workflow. The user performs write actions in Sales Mytrion; Horizon must never claim completion without an actual authorized tool result.',
  ].join('\n');
}

export function buildSalesAutomationDocuments(): PlatformCatalogDocument[] {
  return SALES_AUTOMATION_KNOWLEDGE.map((entry) => {
    const content = renderAutomation(entry);
    return platformDocument({
      title: `Sales Mytrion — ${entry.title} (${entry.codes.join(', ')})`,
      source: `platform://mytrion/sales/automation/${entry.id}`,
      content,
      department: 'sales',
      metadata: {
        catalog: 'platform',
        kind: 'sales-automation',
        mytrion: 'sales',
        automationId: entry.id,
        serviceCodes: entry.codes,
        audience: 'internal',
        department: 'sales',
      },
    });
  });
}
