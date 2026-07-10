/**
 * Octane Scope — the intake lifecycle (source of truth for the journey).
 * Verbatim port of AS_STAGES from the RnD widget's octane-business-panel; stage
 * ids double as /v1/scope/risks nodeIds, shared with the Zoho widget.
 */
import type { StageDef } from './model';

export const OCT_STAGES: StageDef[] = [
  {
    id: 'lead-generation', num: 1, title: 'Lead Generation', short: 'Lead Gen', color: '#00BFFF', icon: 'funnel',
    desc: 'Leads land from every channel and are scored & routed to the right agent automatically.',
    departments: [
      { name: 'Marketing', color: '#EC4899', icon: 'megaphone', items: ['FB Leads (Meta Leads)', 'Website leads'], platforms: ['Meta', 'Facebook', 'Instagram', 'Website', 'Zapier'] },
      { name: 'R&D', color: '#06B6D4', icon: 'beaker', items: ['Lead Import', 'Broker Snapshot (DWH)'], platforms: ['Zoho CRM', 'Zapier', 'Broker Snapshot'] },
      { name: 'Sales', color: '#00BFFF', icon: 'user', items: ['Manual lead creation'], platforms: ['Zoho CRM', 'RingCentral', 'Telegram'] },
    ],
    blueprints: [
      {
        name: 'Marketing Blueprint',
        flow: {
          nodes: [
            { id: 'meta-form', label: 'Meta Instant Form', kind: 'start', platform: 'Meta' },
            { id: 'zapier-1', label: 'Zapier', kind: 'call', platform: 'Zapier' },
            { id: 'landing', label: 'Landing Page', kind: 'start', platform: 'Octane App' },
            { id: 'zapier-2', label: 'Zapier', kind: 'call', platform: 'Zapier' },
            { id: 'crm-gen', label: 'CRM Lead Generation', kind: 'good', platform: 'Zoho CRM' },
            { id: 'lead-dist', label: 'Lead Distribution', kind: 'win', icon: 'sliders' },
          ], edges: [
            { from: 'meta-form', to: 'zapier-1' },
            { from: 'zapier-1', to: 'crm-gen' },
            { from: 'landing', to: 'zapier-2' },
            { from: 'zapier-2', to: 'crm-gen' },
            { from: 'crm-gen', to: 'lead-dist' },
          ],
        },
      },
      {
        name: 'CRM Blueprint',
        flow: {
          nodes: [
            { id: 'source', label: 'Source: Carrier 411 & others', kind: 'start', icon: 'globe' },
            { id: 'excel-export', label: 'Excel Export', kind: 'call', icon: 'clipboard' },
            { id: 'excel-import', label: 'Excel Import into CRM', kind: 'info', platform: 'Zoho CRM' },
            { id: 'gen-bulk', label: 'Lead Generation & manual bulk distribution', kind: 'win', icon: 'people' },
          ], edges: [
            { from: 'source', to: 'excel-export' },
            { from: 'excel-export', to: 'excel-import' },
            { from: 'excel-import', to: 'gen-bulk' },
          ],
        },
      },
    ],
    autoBy: 'R&D',
    engine: {
      by: 'R&D', trigger: 'Lead created in CRM', engine: 'Distribution Engine', output: 'Assigned to Sales Agent',
      factors: [
        { label: 'Online status', icon: 'signal', color: '#2ECC71' },
        { label: 'Weekday / Weekend', icon: 'calendar', color: '#F59E0B' },
        { label: 'Worktime / Off-hours', icon: 'clock', color: '#8B5CF6' },
        { label: 'Justice — weekly count', icon: 'sliders', color: '#EC4899' },
        { label: 'Language', icon: 'globe', color: '#06B6D4' },
      ],
    },
    platforms: ['Meta', 'Facebook', 'Instagram', 'Website', 'Zoho CRM', 'Zapier'],
    metrics: [{ label: 'Budget / month', icon: 'dollar' }, { label: 'Timeline per lead', icon: 'clock' }],
  },
  {
    id: 'lead-cycle', num: 2, title: 'Lead Cycle', short: 'Lead Cycle', color: '#8B5CF6', icon: 'refresh',
    desc: 'A call cadence escalates First → Second → Third until the lead resolves.',
    departments: [
      { name: 'R&D', color: '#06B6D4', icon: 'beaker', items: ['Lead blueprint cycle', 'Data management'], platforms: ['Zoho CRM', 'Zoho Flow', 'Zapier'] },
      { name: 'Marketing', color: '#EC4899', icon: 'megaphone', items: ['Bulk SMS for certain leads'], platforms: ['Twilio', 'Telegram'] },
      { name: 'Sales', color: '#00BFFF', icon: 'user', items: ['Processing of the lead'], platforms: ['Zoho CRM', 'RingCentral', 'Telegram', 'Gong'] },
    ],
    flow: {
      nodes: [
        { id: 'new-lead', label: 'New Lead', kind: 'start', icon: 'user' },
        { id: 'first-call', label: 'First Call', kind: 'call', icon: 'phone', depts: ['Sales'] },
        { id: 'second-call', label: 'Second Call', kind: 'call', icon: 'phone', depts: ['Sales'] },
        { id: 'third-call', label: 'Third Call', kind: 'call', icon: 'phone', depts: ['Sales'] },
        { id: 'interested', label: 'Interested', kind: 'good', icon: 'check', depts: ['Sales'] },
        { id: 'follow-up', label: 'Follow-up', kind: 'info', icon: 'refresh', depts: ['Sales', 'Marketing'] },
        { id: 'email-followup', label: 'Email Follow-up', kind: 'info', icon: 'mail', depts: ['Sales', 'Marketing'] },
        { id: 'not-interested', label: 'Not Interested', kind: 'bad', icon: 'cross', depts: ['Sales'] },
        { id: 'unqualified', label: 'Unqualified', kind: 'bad', icon: 'ban', depts: ['Sales'] },
        { id: 'application-filled', label: 'Application Filled', kind: 'win', icon: 'clipboard', depts: ['Sales'] },
        { id: 'wex', label: 'WEX', kind: 'handoff', icon: 'external' },
      ], edges: [
        { from: 'new-lead', to: 'first-call' },
        { from: 'first-call', to: 'second-call' },
        { from: 'second-call', to: 'third-call' },
        { from: 'third-call', to: 'interested' },
        { from: 'third-call', to: 'follow-up' },
        { from: 'third-call', to: 'email-followup' },
        { from: 'third-call', to: 'not-interested' },
        { from: 'third-call', to: 'unqualified' },
        { from: 'interested', to: 'application-filled' },
        { from: 'application-filled', to: 'wex' },
      ],
    },
    autoBy: 'R&D',
    autos: [
      { icon: 'signal', title: 'Call-status auto-progression', when: 'Agent logs a call outcome in CRM', then: 'Lead status advances automatically — New → First Call → Second Call → Third Call' },
      { icon: 'bell', title: 'Stale-lead reminders', when: "A lead's status isn't updated within SLA", then: 'An auto-reminder is pushed to the lead owner' },
      { icon: 'refresh', title: 'Neglected-lead redistribution', when: 'A lead stays untouched past the limit', then: 'The lead is auto-reassigned to another available agent' },
    ],
    platforms: ['Zoho CRM', 'RingCentral', 'Telegram', 'Twilio', 'Gong'],
    metrics: [{ label: 'Timeline to process', icon: 'clock' }, { label: 'Conversion → App', icon: 'chart' }],
  },
  {
    id: 'wex-cycle', num: 3, title: 'WEX Cycle', short: 'WEX Cycle', color: '#F97316', icon: 'clipboard',
    desc: 'WEX returns the approved application; complete ones auto-convert into a deal, incomplete ones go back to the client.',
    departments: [
      { name: 'WEX', color: '#6366F1', icon: 'external', external: true, items: ['Reviews & approves the application', 'Returns the full application'], platforms: ['WEX'] },
      { name: 'Customer Service', color: '#F97316', icon: 'phone', items: ['Owns fallback deals (Dina Carter)', 'Re-instructs clients on incomplete apps (App Filling C-21, App Update C-2)', 'Responds to WEX tasks (C-19)', 'Logs every action as a Zoho Desk ticket'], platforms: ['Zoho Desk', 'Zoho CRM', 'Telegram', 'RingCentral', 'Gong'] },
      { name: 'R&D', color: '#06B6D4', icon: 'beaker', items: ['Application fetch & field auto-populate', 'Lead-conversion automation'], platforms: ['Zapier', 'Zoho CRM', 'Outlook'] },
      { name: 'Sales', color: '#00BFFF', icon: 'user', items: ['Tracks application status live'], platforms: ['Zoho CRM', 'Sales Mytrion', 'Telegram'] },
    ],
    blueprints: [
      {
        name: 'Main',
        flow: {
          nodes: [
            { id: 'application-received', label: 'Application Received', kind: 'start', icon: 'clipboard' },
            { id: 'review-application', label: 'Review Application', kind: 'call', icon: 'eye' },
            { id: 'complete-q', label: 'Application complete?', kind: 'decision', icon: 'check' },
            { id: 'reinstruct', label: 'Re-give instructions to client', kind: 'info', icon: 'mail' },
            { id: 'lead-conversion', label: 'Lead Conversion (CRM)', kind: 'call', icon: 'bolt' },
            { id: 'found-q', label: 'Lead found in CRM?', kind: 'decision', icon: 'eye' },
            { id: 'convert-found', label: 'Convert lead → Deal', kind: 'win', icon: 'card' },
            { id: 'create-lead', label: 'Create lead', kind: 'info', icon: 'user' },
            { id: 'convert-created', label: 'Convert lead → Deal', kind: 'win', icon: 'card' },
            { id: 'deal-cycle', label: 'Deal Cycle', kind: 'deal', icon: 'external' },
          ], edges: [
            { from: 'application-received', to: 'review-application' },
            { from: 'review-application', to: 'complete-q' },
            { from: 'complete-q', to: 'lead-conversion', label: 'Complete' },
            { from: 'complete-q', to: 'reinstruct', label: 'Incomplete' },
            { from: 'lead-conversion', to: 'found-q' },
            { from: 'found-q', to: 'convert-found', label: 'Found' },
            { from: 'found-q', to: 'create-lead', label: 'Not found' },
            { from: 'create-lead', to: 'convert-created' },
            { from: 'convert-found', to: 'deal-cycle' },
            { from: 'convert-created', to: 'deal-cycle' },
          ],
        },
      },
      {
        // Customer Support SOP v1.0 — CS owns incomplete WEX applications: it re-instructs
        // the client (App Filling C-21 / Application Update C-2) and carries fallback deals
        // (Dina Carter) until the application is complete enough to re-enter WEX review.
        name: 'Customer Service Blueprint',
        flow: {
          nodes: [
            { id: 'cs-incomplete', label: 'Incomplete Application', kind: 'start', icon: 'clipboard' },
            { id: 'cs-takeover', label: 'CS Takes Ownership', kind: 'call', icon: 'phone' },
            { id: 'cs-reinstruct', label: 'Re-instruct & App Filling · C-21, C-2', kind: 'info', icon: 'mail' },
            { id: 'cs-await', label: 'Await Resubmission', kind: 'info', icon: 'refresh' },
            { id: 'cs-resubmitted', label: 'Client Resubmits', kind: 'good', icon: 'check' },
            { id: 'cs-fallback', label: 'Fallback Deal — Dina Carter', kind: 'win', icon: 'user' },
            { id: 'cs-back', label: 'Back to WEX Review', kind: 'handoff', icon: 'external' },
          ], edges: [
            { from: 'cs-incomplete', to: 'cs-takeover' },
            { from: 'cs-takeover', to: 'cs-reinstruct' },
            { from: 'cs-takeover', to: 'cs-fallback', label: 'No owner' },
            { from: 'cs-reinstruct', to: 'cs-await' },
            { from: 'cs-await', to: 'cs-resubmitted' },
            { from: 'cs-resubmitted', to: 'cs-back' },
            { from: 'cs-fallback', to: 'cs-back' },
          ],
        },
      },
    ],
    autoBy: 'R&D',
    autos: [
      { icon: 'bolt', title: 'Full application fetch from WEX', when: 'WEX returns the approved application', then: 'Every field is auto-populated onto the CRM record' },
      { icon: 'refresh', title: 'Lead conversion', when: 'An application is complete', then: "Lead is converted to a Deal — created first if it doesn't exist" },
      { icon: 'eye', title: 'Live tracking — Sales Mytrion', when: 'An application is in progress', then: 'Agents track its full status live in Sales Mytrion' },
      { icon: 'bell', title: 'Application tracking in Telegram', when: 'Application status changes', then: 'The update is pushed to Telegram' },
      { icon: 'mail', title: 'Tracking numbers from Outlook', when: 'A tracking-number email lands in Outlook', then: 'The tracking number is auto-captured to the deal' },
      { icon: 'card', title: 'Carrier ID auto-tracking', when: 'A carrier ID is issued', then: 'It is auto-tracked on the deal record' },
      { icon: 'external', title: 'Interconnected with the Deal Cycle', when: 'A WEX application converts', then: 'It flows straight into the Deal Cycle pipeline' },
    ],
    platforms: ['WEX', 'Zoho CRM', 'Zoho Desk', 'Zapier', 'Telegram', 'Outlook', 'Sales Mytrion', 'RingCentral', 'Gong'],
    metrics: [{ label: 'WEX review time', icon: 'clock' }, { label: 'App → Deal rate', icon: 'chart' }],
  },
  {
    id: 'deal-cycle', num: 4, title: 'Deal Cycle', short: 'Deal Cycle', color: '#14B8A6', icon: 'card',
    desc: 'The Zoho pipeline runs itself from application to the first card swipe.',
    departments: [
      { name: 'Customer Service', color: '#F97316', icon: 'phone', items: ['Owns & moves the pipeline; onboards client to first swipe', 'Activates & sets up cards in EFS eManager (C-1); prompts & limits when Verification directs', 'App / unit updates (C-2, C-26), WEX tasks (C-19), tracking # (C-22), Carrier ID (C-23)', 'Sends invoices (C-20); routes every credit / LOC question to Verification — never decides credit', 'Communicates account type to client: LOC / Deposit 1:1 / Prepay'], platforms: ['EFS', 'Zoho Desk', 'Zoho CRM', 'Telegram', 'RingCentral', 'Gong'] },
      { name: 'Verification', color: '#4ADE80', icon: 'check', items: ['Application review & approval', 'Assigns account type — LOC / Deposit 1:1 / Prepay', 'Sets the spending limit (cash-flow formula)'], platforms: ['Zoho CRM'] },
      { name: 'Billing', color: '#6366F1', icon: 'dollar', items: ['Billing form & card funding'], platforms: ['EFS', 'Zoho CRM'] },
      { name: 'Sales', color: '#00BFFF', icon: 'user', items: ["Owns the deal (lead's agent)"], platforms: ['Zoho CRM'] },
      { name: 'R&D', color: '#06B6D4', icon: 'beaker', items: ['Pipeline automation'], platforms: ['Zapier', 'Synology'] },
    ],
    blueprints: [
      {
        name: 'Main',
        flow: {
          nodes: [
            { id: 'application-filled', label: 'Application Filled', kind: 'start', icon: 'clipboard', note: 'Automatic — WEX application confirmed.' },
            { id: 'application-processing', label: 'Processing', kind: 'call', icon: 'refresh', note: 'Automatic — default stage.' },
            { id: 'application-approved', label: 'Approved', kind: 'good', icon: 'check', note: 'Automatic — when WEX approves the application and the Carrier ID is received.' },
            { id: 'cards-sent', label: 'Cards Sent', kind: 'info', icon: 'card', note: 'Automatic — when the tracking number is received.' },
            { id: 'cards-delivered', label: 'Cards Delivered', kind: 'info', icon: 'card', note: 'Automatic — we track whether the card is delivered and update the status.' },
            { id: 'billing-form-sent', label: 'Billing Form Sent', kind: 'call', icon: 'dollar', note: 'Automatic — after the card is delivered, the Billing Form link is sent automatically.' },
            { id: 'billing-form-filled', label: 'Billing Form Filled', kind: 'call', icon: 'dollar', note: 'Automatic — once billing is received, the info is pulled from CMP and updated.' },
            { id: 'card-funded', label: 'Card Funded', kind: 'good', icon: 'check', note: 'Automatic — after billing is verified, the card is funded.' },
            { id: 'card-swiped', label: 'Card Swiped', kind: 'win', icon: 'card', note: 'Automatic — when the client uses the card for the first time, the status updates.' },
            { id: 'closed-lost', label: 'Closed / Lost', kind: 'bad', icon: 'cross', side: 'left' },
          ], edges: [
            { from: 'application-filled', to: 'application-processing' },
            { from: 'application-filled', to: 'closed-lost', label: 'Lost' },
            { from: 'application-processing', to: 'application-approved' },
            { from: 'application-approved', to: 'cards-sent' },
            { from: 'cards-sent', to: 'cards-delivered' },
            { from: 'cards-delivered', to: 'billing-form-sent' },
            { from: 'billing-form-sent', to: 'billing-form-filled' },
            { from: 'billing-form-filled', to: 'card-funded' },
            { from: 'card-funded', to: 'card-swiped' },
          ],
        },
      },
      {
        // Intentionally left empty — to be (re)mapped later. Renders an empty-state placeholder.
        name: 'Customer Service Blueprint',
        flow: { nodes: [], edges: [] },
      },
      {
        // Verification Dept SOP v3.3 §4 — the internal verification flow, which begins
        // the moment the deal is created (application filled). 4 mandatory steps with the
        // real decision branches + the SOP's actual outcomes (LOC / Prepay-Deposit / Decline / WEX).
        name: 'Verification Blueprint',
        flow: {
          nodes: [
            { id: 'vf-app', label: 'Application Filled', kind: 'start', icon: 'clipboard', tools: 'CMP' },
            { id: 'vf-step1', label: 'Step 1 — Carrier Lookup', kind: 'call', icon: 'eye', tools: 'FMCSA · Highway · CreditSafe' },
            { id: 'vf-cross', label: 'Cross-Check vs Public Data', kind: 'call', icon: 'check', tools: 'FMCSA · Highway · CreditSafe · CMP' },
            { id: 'vf-cards', label: 'Cards Requested?', kind: 'decision', icon: 'card', tools: 'CMP (card count vs fleet)' },
            { id: 'vf-wex', label: 'WEX-Funded App (21+)', kind: 'handoff', icon: 'external', tools: 'WEX' },
            { id: 'vf-authority', label: 'USDOT / MC Active?', kind: 'decision', icon: 'check', tools: 'FMCSA' },
            { id: 'vf-scenario', label: 'Scenario A / B Docs (72h)', kind: 'info', icon: 'mail', tools: 'Outlook · RingCentral · CMP' },
            { id: 'vf-fraud', label: 'Fraud / Blacklist?', kind: 'decision', icon: 'ban', tools: 'Highway · Citifuel · CMP' },
            { id: 'vf-decline', label: 'Decline — Flag in CMP', kind: 'bad', icon: 'cross', tools: 'CMP' },
            { id: 'vf-step2', label: 'Step 2 — Financial Verify', kind: 'call', icon: 'dollar', tools: 'Plaid · Stripe · Bank Statements' },
            { id: 'vf-hardstop', label: 'Hard Stops Pass?', kind: 'decision', icon: 'check', tools: 'Plaid · Stripe' },
            { id: 'vf-prepay', label: 'Prepay / Deposit 1:1', kind: 'info', icon: 'dollar', tools: 'EFS · CMP' },
            { id: 'vf-step3', label: 'Step 3 — iSoftPull Credit', kind: 'call', icon: 'eye', tools: 'iSoftPull' },
            { id: 'vf-step4', label: 'Step 4 — Limit Assignment', kind: 'good', icon: 'sliders', tools: 'LOC Calculator (Synology) · CMP' },
            { id: 'vf-tier', label: 'Tier — Weak / Mod / Strong', kind: 'info', icon: 'chart', tools: 'CMP' },
            { id: 'vf-loc', label: 'LOC Approved — Cards Issued', kind: 'win', icon: 'card', tools: 'EFS / WEX · CMP' },
          ], edges: [
            { from: 'vf-app', to: 'vf-step1' },
            { from: 'vf-step1', to: 'vf-cross' },
            { from: 'vf-cross', to: 'vf-cards' },
            { from: 'vf-cards', to: 'vf-authority', label: '1–20' },
            { from: 'vf-cards', to: 'vf-wex', label: '21+' },
            { from: 'vf-authority', to: 'vf-fraud', label: 'Active' },
            { from: 'vf-authority', to: 'vf-scenario', label: 'Inactive' },
            { from: 'vf-scenario', to: 'vf-fraud', label: 'Docs OK' },
            { from: 'vf-scenario', to: 'vf-decline', label: 'No docs' },
            { from: 'vf-fraud', to: 'vf-step2', label: 'Clear' },
            { from: 'vf-fraud', to: 'vf-decline', label: 'Match' },
            { from: 'vf-step2', to: 'vf-hardstop' },
            { from: 'vf-hardstop', to: 'vf-step3', label: 'Pass' },
            { from: 'vf-hardstop', to: 'vf-prepay', label: 'Fail' },
            { from: 'vf-step3', to: 'vf-step4' },
            { from: 'vf-step4', to: 'vf-tier' },
            { from: 'vf-tier', to: 'vf-loc' },
          ],
        },
      },
      {
        // Billing SOP §3.5–§3.7 — billing-form setup once the client has a Carrier ID
        // (LOC / Deposit). Bank + card + payment method + voided check → review → fund.
        name: 'Billing Blueprint',
        flow: {
          nodes: [
            { id: 'bl-form-sent', label: 'Billing Form Sent', kind: 'start', icon: 'dollar', tools: 'Form Site (secure link)' },
            { id: 'bl-form-filled', label: 'Client Fills Form', kind: 'call', icon: 'clipboard', tools: 'Bank · card · payment method · voided check' },
            { id: 'bl-review', label: 'Billing Review', kind: 'call', icon: 'eye', tools: 'Validate bank + card; company-name match' },
            { id: 'bl-match', label: 'Voided Check Matches?', kind: 'decision', icon: 'check' },
            { id: 'bl-newcheck', label: 'Request New Voided Check', kind: 'info', icon: 'mail' },
            { id: 'bl-method', label: 'Payment Method', kind: 'info', icon: 'dollar', tools: 'ACH · Wire · Zelle · Auto Pay' },
            { id: 'bl-fund', label: 'Fund Card (EFS)', kind: 'good', icon: 'card', tools: 'EFS' },
            { id: 'bl-funded', label: 'Card Funded', kind: 'win', icon: 'check' },
          ], edges: [
            { from: 'bl-form-sent', to: 'bl-form-filled' },
            { from: 'bl-form-filled', to: 'bl-review' },
            { from: 'bl-review', to: 'bl-match' },
            { from: 'bl-match', to: 'bl-newcheck', label: 'Mismatch' },
            { from: 'bl-match', to: 'bl-method', label: 'Match' },
            { from: 'bl-method', to: 'bl-fund' },
            { from: 'bl-fund', to: 'bl-funded' },
          ],
        },
      },
    ],
    autoBy: 'R&D',
    autos: [
      { icon: 'bolt', text: 'Every pipeline stage is automated — the deal advances without manual moves' },
      { icon: 'refresh', text: 'Statuses sync from source events: WEX approval, card tracking, billing, first swipe' },
    ],
    platforms: ['Zoho CRM', 'Zoho Desk', 'Synology', 'EFS', 'Telegram', 'RingCentral', 'Gong'],
    metrics: [{ label: 'Pipeline time', icon: 'clock' }, { label: 'Deal → active rate', icon: 'chart' }],
  },
  {
    id: 'client-stage', num: 5, title: 'Client Stage', short: 'Client', color: '#2ECC71', icon: 'user',
    desc: 'The customer is live and fueling — the destination of the intake journey.',
    departments: [], platforms: [], metrics: [], terminal: true,
  },
];
