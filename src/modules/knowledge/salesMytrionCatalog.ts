import { platformDocument, type PlatformCatalogDocument } from './platformDocument.js';
import { buildSalesAutomationDocuments } from './salesMytrionAutomations.js';

function salesDocument(
  slug: string,
  title: string,
  kind: string,
  content: string,
): PlatformCatalogDocument {
  return platformDocument({
    title,
    source: `platform://mytrion/sales/${slug}`,
    content,
    department: 'sales',
    metadata: {
      catalog: 'platform',
      kind,
      mytrion: 'sales',
      audience: 'internal',
      department: 'sales',
    },
  });
}

function overview(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Overview and navigation

Sales Mytrion is the Sales agent workspace. Its normal workday context is 10:00 AM–7:00 PM Eastern Time.

## Sidebar
- Home: daily goal, announcements and what needs a call.
- Inbox: reminders, alerts and assigned notifications.
- Data Center: the signed-in agent's Clients, Leads, Deals, Rejections and Money Codes.
- Create: create a lead or raise a ticket/escalation request.
- Carriers: search a carrier by DOT, company or phone, then create a lead.
- Retention: My cases and the shared Open Pool for quiet clients.
- Automations: live self-service Customer Service, Billing and WEX workflows. Search by title, service code or keyword.
- Dashboard: live Sales, company and debtor reporting.
- My Tasks: manager-assigned work cards; drag cards between status columns or open details/history.
- Call Hub: the signed-in agent's Mytrion and Zoho call history, with filters and redial.
- Tickets: Coming soon. Create files the request into Zoho Desk; the team works it there.
- Verification: Coming soon and not currently navigable.

## Horizon behavior
For a Sales Mytrion how-to question, route to the Sales specialist and search this governed catalog. Explain the exact path and inputs. A how-to answer does not need escalation merely because the UI action is a write. If the user asks Horizon to perform the write, Horizon must say it cannot unless it has an authorized write tool result, then direct the user to the documented Sales Mytrion workflow.`;
  return salesDocument(
    'overview',
    'Sales Mytrion — Overview, Navigation and Availability',
    'sales-overview',
    content,
  );
}

function dailyWork(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Daily workspace

## Home
Open Sales Mytrion → Home for the day-at-a-glance view: daily goal/progress, announcements, inbox items and clients or work that need attention. Goal or personal-best celebrations appear at most once per day.

## Inbox
Open Sales Mytrion → Inbox for reminders, automation results, Retention events and manager/system notifications. Use the item action to open its relevant destination when available.

## My Tasks
Open Sales Mytrion → My Tasks. The board reads the same worker-task records assigned by Manager desks. Click a card for its detail/history. Drag a card to another column to update its status; an overdue card is visually identified. This tab is live.

## Call Hub
Open Sales Mytrion → Call Hub. It shows calls owned by the signed-in agent only, merging outbound Mytrion clicks with Zoho Call records. Filter by source/status or date, open a row for detail and use redial where available. Calls launched from Data Center and Retention are attributed here. The global softphone remains separate.`;
  return salesDocument(
    'daily-workspace',
    'Sales Mytrion — Home, Inbox, My Tasks and Call Hub',
    'sales-daily-workspace',
    content,
  );
}

function recordsAndCarriers(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Data Center and Carriers

## Data Center
Open Sales Mytrion → Data Center. It is owner-scoped to the signed-in agent and has:
- Clients: search by name, carrier ID or contact. Account-status filters (All, Active, Debtor) compose with the separate loyalty-tier filter. Click a client card for detail. The View mini-app button is available only for eligible active, non-debtor companies.
- Leads: search name, company, source, email or phone; filter status/source or Meta leads; switch Board/List. New assigned leads appear here.
- Deals: search company or deal name; filter stage; switch Board/List. Deals appear after lead conversion.
- Rejection Reports: search company, application ID or reason, then open a row for its decline detail.
- Money Codes: search company/carrier ID, filter ISSUED/USED/VOIDED, and load more in pages of 25. Codes are never shown. An eligible issued request can be voided only through its confirmation flow with a reason.

## Carriers
Open Sales Mytrion → Carriers. Enter at least three characters of a DOT number, company name or phone. Search is debounced and returns at most 50 rows, so refine broad terms. Filter Authorized/Not Authorized/Out of Service, Has phone/email and minimum units. Review the account-at-a-glance row, then choose Create Lead. Success links to the new Zoho Lead; duplicate detection shows Already exists with a link instead of creating another record; a transient failure can be retried.`;
  return salesDocument(
    'records-create-carriers',
    'Sales Mytrion — Data Center and Carrier Lookup',
    'sales-records',
    content,
  );
}

function createWorkflows(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Create Ticket, Escalation and Lead

Open Sales Mytrion → Create and choose one of three tabs.

## Create Ticket
1. Department: choose Customer Service, Billing & Accounting, Verification or Maintenance. This controls the Zoho Desk destination and ticket-type list.
2. Deal: select one of the five most recent deals or search the full owner-scoped list by name, company, carrier ID, application ID or phone.
3. Details: choose a ticket type; review/edit contact email and phone; optionally select a card; enter required Subject and Description; optionally attach one file up to 20 MB; click Create Ticket.

If the selected service code already has a live Sales Mytrion Automation, the wizard says “You can do this yourself” and offers to open that Automation instead of filing a ticket. Otherwise the ticket and optional attachment are sent together to Zoho Desk. The Tickets tab is Coming soon, so the receiving team works it in Zoho Desk; do not promise that Sales Mytrion opens a ticket console.

## Escalate Request
Choose Escalate Request. Enter required Subject and Description, select the closest reason from the displayed picklist, optionally attach one file up to 20 MB, then click Create Escalation Ticket. The backend creates the escalation record and its Zoho Desk ticket together and routes it; there is no department picker in this form.

## Create Lead
Choose Create Lead. Select Mr/Ms, optionally enter First Name, and enter required Last Name, Company Name and exactly 10 phone digits. Click Create Lead. Success adds it under the signed-in agent and provides a Zoho link. If CRM reports a duplicate, Sales Mytrion shows Lead already exists and links to that record instead of creating another lead.`;
  return salesDocument(
    'create',
    'Sales Mytrion — Create Ticket, Escalation and Lead Workflows',
    'sales-create',
    content,
  );
}

function automationGuide(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Automations operating guide

Open Sales Mytrion → Automations. Search by automation title, service code such as C-1 or C-16, or a keyword, then click the matching block. There are 23 runnable blocks in the current catalog; each has its own governed knowledge document.

## Finding a block
- The search box matches the block title, its description text and its service codes, case-insensitively. Searching \`fraud\`, \`C-16\` or \`override\` all reach Override the Card.
- With no search term the catalog is grouped into labelled sections: Customer Service (C codes) and Billing (Q codes). Verification and Management sections exist in the layout but hold no live block today, and an empty section is hidden rather than shown empty.
- Customer Service holds Transactions Report, Card Status Report, Tracking Number Request, Card Last Used Check, Card Activation, Card Deactivation, Increase / Decrease Limits, Unit / Driver Change, Fraud Hold / Release, Override the Card, Card Replacement, Account Reactivation, Money Code, BOCA Link Request, Close Application, Application Update — WEX Tasks, WEX Applications and EFS Login.
- Billing holds Request Invoices, Check Payment Information, Billing Forms, Balance Check and Account Status Check.
- Each card shows its service-code chips and a one-line description. Blocks can be dragged into a preferred order, which is saved per agent on that device only and does not change anyone else's catalog. Order is a personal preference, so describe a block by its section and codes rather than by position.
- When a search matches nothing the catalog says “No actions match your search” and suggests a code like C-16 or a keyword like fraud.

## Shared behavior
- Deals/clients load only when the selected automation needs them. Most account actions start with a client selection.
- Card actions then load the client's live cards. Fraud Hold / Release and Override show fraud-held cards only.
- Card Activation and Unit / Driver Change show current EFS information and prefill available unit/driver values.
- WEX browser actions require a deal with a current application ID and a passing eligibility check; owner/application context is loaded from the application.
- Run remains disabled until required fields and live prerequisite checks pass.
- While a write is running, keep the modal open. Duplicate dispatch is blocked. After about 90 seconds, the watchdog says to keep it open rather than submitting again.
- Success and failure are shown in the modal. Run another reloads live card data where relevant.
- Numeric/account truth comes from the named live integration, not from the model.

Horizon answers how-to questions from these documents, but Sales Mytrion remains the place where the user performs the action.`;
  return salesDocument(
    'automations',
    'Sales Mytrion — Automations Catalog and Shared Behavior',
    'sales-automations-guide',
    content,
  );
}

function retention(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Retention lifecycle and Open Pool

## How cases are generated
The hourly Retention sync scans active, Card-Swiped, non-debtor deals that are not Closed Lost or Out of Business. It compares days inactive with the carrier's last-90-day cadence: high frequency 2 days, medium 5 days, low 7 days. A breached eligible deal with no open case creates a Phase 1 Sales case in Working/New; an existing case has its DWH metrics refreshed. Pilot configuration can restrict new-case creation to an agent allowlist.

Any transaction after an open case was created automatically closes it as Returned during the hourly sync, in every phase including Open Pool, Retention and CITI. Returned is therefore not a manual stage. Pending pool claims are removed when this happens.

## My cases
Open Sales Mytrion → Retention → My cases. Switch Kanban/List, search carrier or company, and open an unlocked card. Priority sorts by breach severity and then 90-day gallons. New cases already start Working; call the client and stage the result:
- Reached: watches 5 business days for fuel. A new transaction closes Returned; no fuel sends it to Open Pool.
- Out of Reach: log a contact-channel attempt. Each attempt has a 1-business-day SLA; after five failed attempts it may be sent to Open Pool.
- Dissatisfied: reason is required; switched/other requires a note. A configured Retention handoff starts a 10-business-day wait. If the handoff kill switch is off, the case stays Sales Dissatisfied.
- Vacation: begins a 14-calendar-day countdown, then a 2-business-day follow-up. A second vacation result awaits Ops signoff. Confirmation resets Phase 1; denial sends the case to CITI.
- No action for 2 business days, or manual escalation, moves the case to Retention when enabled.

Business-day timers skip Saturday and Sunday; holidays are not modeled. Cards handed to Open Pool, Retention or CITI remain visible to the former Sales owner but are locked.

## Open Pool
Open Sales Mytrion → Retention → Open Pool. It shows other agents' available cases, never your own former deals. Search/sort, select one or multiple rows, click Claim, enter a required reason and confirm. Claiming is immediate, moves the deal to your New column and attempts the configured Zoho ownership update.

- Maximum 2 approved claims per agent per UTC day.
- A pool item is available for 3 business days; if unclaimed it moves to Retention for a 10-business-day wait, unless the three-agent cap sends it to CITI.
- A deal cycles through at most 3 Sales agents. A failed third-agent window goes to CITI.
- A 10-business-day Retention expiry can return to Open Pool; after 3 Retention-to-Pool returns it goes to CITI.
- Reached/no fuel, five Out-of-Reach attempts, and Retention expiry are the main pool entry paths.
- New fuel at any point closes the case Returned on the hourly sync.`;
  return salesDocument(
    'retention',
    'Sales Mytrion — Retention Case Generation, Stages and Open Pool',
    'sales-retention',
    content,
  );
}

function reporting(): PlatformCatalogDocument {
  const content = `# Sales Mytrion — Dashboard and feature availability

Open Sales Mytrion → Dashboard and choose:
- Sales: the agent's current-cycle gallons/swipes, active/inactive/stuck companies, active/card utilization, cards per company, transactions per card, new cards, carrier charts and transaction detail. Refresh bypasses the short dashboard cache.
- Company: company-wide Applications and Gallon Volume gauges for Today, This Week and This Month with their targets.
- Debtors: the agent's own pending/partial invoices that are at least the configured minimum days overdue. Search carrier/company/deal/stage; filter All/Pending/Partial/Hard; expand a carrier to see invoices. The current UI labels Hard at 15+ overdue days.
- Power BI: opens the embedded Sales report.

Treat displayed metrics as live application data. When a user asks Horizon for an authoritative count, balance, rate or total, use an authorized typed tool; this knowledge describes navigation and meaning but is not a substitute for current figures.

Current availability:
- Dashboard: live.
- My Tasks: live.
- Call Hub: live.
- Tickets: Coming soon; Create sends requests into Zoho Desk.
- Verification: Coming soon and not navigable.

Do not describe a Coming soon screen as available merely because implementation code exists behind the navigation gate.`;
  return salesDocument(
    'reporting-availability',
    'Sales Mytrion — Dashboard and Feature Availability',
    'sales-reporting',
    content,
  );
}

export function buildSalesMytrionCatalog(): PlatformCatalogDocument[] {
  return [
    overview(),
    dailyWork(),
    recordsAndCarriers(),
    createWorkflows(),
    automationGuide(),
    retention(),
    reporting(),
    ...buildSalesAutomationDocuments(),
  ];
}
