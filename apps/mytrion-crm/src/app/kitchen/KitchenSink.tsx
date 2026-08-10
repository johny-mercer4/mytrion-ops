import { useState } from 'react';
import {
  AgentBadge, AgentStatus, ApprovalBar, Avatar, AvatarGroup, Badge, Button, Checkbox,
  CitationChip, ConfidenceMeter, ConfirmDialog, DataTable, Dialog, Drawer, DropdownMenu, ElicitationPicker,
  Icon, InlineDiff, Input, Pagination, Provenance, Radio, RadioGroup, RetryButton, Select,
  Skeleton, SourceList, StoppedNote, StopButton, StreamingText, StructuredOutput, Switch, Table,
  TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TabPanel, Tabs, Textarea, ToolCallCard,
  ToolCallList, Tooltip, TurnError,
} from '@/ds';
import type { DataColumn } from '@/ds';
import { KitchenShell, Row, Section, Specimen, ThemePair } from './KitchenShell';

/**
 * Every design-system component, in every state, in both themes.
 *
 * This is the review surface. It renders with no backend, no session and no route guard, which is
 * the whole point — a design system nobody can see is a design system nobody reviews.
 */

const SECTIONS = [
  'Icon', 'Button', 'Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'Switch',
  'Badge', 'Avatar', 'Table', 'DataTable', 'Tabs', 'Pagination', 'Skeleton',
  'Tooltip', 'DropdownMenu', 'Dialog', 'Drawer',
  'Streaming text', 'Agent status', 'Tool calls', 'Citations', 'Confidence',
  'Inline diff', 'Approval', 'Stop and retry', 'Turn error', 'Structured output', 'Elicitation',
];

/**
 * DataTable's specimen data. Deliberately a shape with more columns than a card can hold, because
 * the interesting behaviour is what happens to columns 4..N — they move to the detail sheet rather
 * than being squeezed into the row.
 */
interface DemoRow {
  id: string;
  carrier: string;
  unit: string;
  date: string;
  driver: string;
  status: 'Settled' | 'Pending' | 'Disputed';
  amount: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: '1', carrier: 'Northwind Freight', unit: 'Unit 302', date: 'Mar 14', driver: 'D. Carter', status: 'Settled', amount: '4,912.08' },
  { id: '2', carrier: 'Cascade Logistics', unit: 'Unit 117', date: 'Mar 14', driver: 'M. Ortiz', status: 'Pending', amount: '3,447.11' },
  { id: '3', carrier: 'Redline Haulage', unit: 'Unit 88', date: 'Mar 13', driver: 'A. Whitfield', status: 'Disputed', amount: '1,208.40' },
];

const DEMO_INTENT = { Settled: 'success', Pending: 'warning', Disputed: 'danger' } as const;

const DEMO_COLUMNS: DataColumn<DemoRow>[] = [
  { id: 'carrier', header: 'Carrier', cell: (r) => r.carrier, mobile: 'primary', rowHeader: true },
  { id: 'unit', header: 'Unit', cell: (r) => r.unit, mobile: 'secondary' },
  { id: 'date', header: 'Date', cell: (r) => r.date, mobile: 'secondary', priority: 2 },
  { id: 'driver', header: 'Driver', cell: (r) => r.driver, priority: 3 },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => <Badge intent={DEMO_INTENT[r.status]} size="sm">{r.status}</Badge>,
    mobile: 'value',
  },
  { id: 'amount', header: 'Amount', cell: (r) => r.amount, numeric: true, align: 'end' },
];

export default function KitchenSink() {
  const [tab, setTab] = useState('overview');
  const [page, setPage] = useState(3);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [radio, setRadio] = useState('daily');
  const [select, setSelect] = useState<string | null>('citi');

  return (
    <KitchenShell sections={SECTIONS}>
      {/* ── Foundation ─────────────────────────────────────────────────── */}
      <Section title="Icon" subtitle="Material Symbols Sharp — one family, two sizes, FILL as the selected-state axis.">
        <ThemePair>
          <Row>
            <Specimen label="20px idle">
              <Icon name="refresh" /><Icon name="search" /><Icon name="local_gas_station" />
              <Icon name="account_balance" /><Icon name="credit_card" /><Icon name="warning" />
            </Specimen>
            <Specimen label="20px FILL 1">
              <Icon name="refresh" filled /><Icon name="search" filled /><Icon name="local_gas_station" filled />
              <Icon name="account_balance" filled /><Icon name="credit_card" filled /><Icon name="warning" filled />
            </Specimen>
            <Specimen label="16px">
              <Icon name="refresh" size="sm" /><Icon name="search" size="sm" />
              <Icon name="local_gas_station" size="sm" /><Icon name="warning" size="sm" />
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <Section title="Button" subtitle="Five variants × two sizes × the full state matrix. Replaces 60+ bespoke .btn classes.">
        <ThemePair>
          <Row>
            <Specimen label="primary"><Button variant="primary">Save changes</Button></Specimen>
            <Specimen label="secondary"><Button>Cancel</Button></Specimen>
            <Specimen label="ghost"><Button variant="ghost">Filter</Button></Specimen>
            <Specimen label="danger"><Button variant="danger">Delete carrier</Button></Specimen>
            <Specimen label="link"><Button variant="link">View record</Button></Specimen>
          </Row>
          <Row>
            <Specimen label="with icon"><Button icon="refresh">Refresh</Button></Specimen>
            <Specimen label="trailing"><Button iconEnd="arrow_forward" variant="primary">Continue</Button></Specimen>
            <Specimen label="icon only"><Button icon="delete" variant="ghost" aria-label="Delete" /></Specimen>
            <Specimen label="loading"><Button loading variant="primary">Save changes</Button></Specimen>
            <Specimen label="disabled"><Button disabled>Unavailable</Button></Specimen>
          </Row>
          <Row>
            <Specimen label="sm"><Button size="sm">Small</Button></Specimen>
            <Specimen label="sm primary"><Button size="sm" variant="primary">Apply</Button></Specimen>
            <Specimen label="sm icon"><Button size="sm" icon="close" variant="ghost" aria-label="Dismiss" /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      {/* ── Forms ──────────────────────────────────────────────────────── */}
      <Section title="Input" subtitle="The wrapper owns focus-within chrome; the bare field never takes the hard outline.">
        <ThemePair>
          <Row>
            <Specimen label="default"><Input placeholder="Carrier name" /></Specimen>
            <Specimen label="with icon"><Input icon="search" placeholder="Search carriers" /></Specimen>
            <Specimen label="invalid"><Input invalid defaultValue="not-an-email" message="Enter a valid email address." /></Specimen>
          </Row>
          <Row>
            <Specimen label="disabled"><Input disabled defaultValue="Locked" /></Specimen>
            <Specimen label="password"><Input type="password" defaultValue="hunter2" /></Specimen>
            <Specimen label="sm"><Input size="sm" placeholder="Compact" /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Textarea">
        <ThemePair>
          <Row>
            <Specimen label="default"><Textarea placeholder="Notes on this account…" rows={3} /></Specimen>
            <Specimen label="invalid"><Textarea invalid rows={3} defaultValue="Too short" message="Add at least 20 characters." /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Select" subtitle="Replaces seven bespoke pickers. Combobox pattern with aria-activedescendant.">
        <ThemePair>
          <Row>
            <Specimen label="single">
              <Select
                label="Fuel network"
                options={[
                  { value: 'citi', label: 'CITI Fuel' },
                  { value: 'efs', label: 'EFS / WEX' },
                  { value: 'pilot', label: 'Pilot Flying J' },
                ]}
                value={select}
                onChange={setSelect}
              />
            </Specimen>
            <Specimen label="searchable">
              <Select
                label="Assign to"
                searchable
                placeholder="Search agents"
                options={[
                  { value: 'a', label: 'Alice Nowak' },
                  { value: 'b', label: 'Bogdan Ilic' },
                  { value: 'c', label: 'Chen Wu' },
                ]}
                value={null}
                onChange={() => {}}
              />
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Checkbox">
        <ThemePair>
          <Row>
            <Specimen label="states">
              <Checkbox label="Unchecked" />
              <Checkbox label="Checked" defaultChecked />
              <Checkbox label="Indeterminate" indeterminate />
              <Checkbox label="Disabled" disabled />
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Radio">
        <ThemePair>
          <Specimen label="group">
            <RadioGroup name="cadence" value={radio} onChange={setRadio} label="Report cadence">
              <Radio value="daily" label="Daily" />
              <Radio value="weekly" label="Weekly" description="Sent Monday 06:00" />
              <Radio value="never" label="Never" />
            </RadioGroup>
          </Specimen>
        </ThemePair>
      </Section>

      <Section title="Switch" subtitle="For immediate effect. If it needs a Save button it should be a Checkbox.">
        <ThemePair>
          <Row>
            <Specimen label="off"><Switch label="Auto-approve under $500" /></Specimen>
            <Specimen label="on"><Switch label="Notify on failure" defaultChecked /></Specimen>
            <Specimen label="disabled"><Switch label="Locked by policy" disabled /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      {/* ── Display ────────────────────────────────────────────────────── */}
      <Section title="Badge" subtitle="Never colour alone — an icon or a label carries the meaning.">
        <ThemePair>
          <Row>
            <Specimen label="intents">
              <Badge intent="success" icon="check_circle">Active</Badge>
              <Badge intent="warning" icon="warning">Past due</Badge>
              <Badge intent="danger" icon="error">Suspended</Badge>
              <Badge intent="info" icon="info">Pending</Badge>
              <Badge intent="neutral">Draft</Badge>
            </Specimen>
            <Specimen label="dot + sm">
              <Badge intent="success" dot size="sm">Live</Badge>
              <Badge intent="neutral" dot size="sm">Idle</Badge>
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Avatar">
        <ThemePair>
          <Row>
            <Specimen label="sizes">
              <Avatar initials="AN" size="xs" /><Avatar initials="BI" size="sm" />
              <Avatar initials="CW" size="md" /><Avatar initials="DK" size="lg" />
            </Specimen>
            <Specimen label="status"><Avatar initials="AN" status="online" statusLabel="Online" /></Specimen>
            <Specimen label="group">
              <AvatarGroup max={3} label="Alice, Bogdan, Chen and 2 others">
                <Avatar initials="AN" /><Avatar initials="BI" /><Avatar initials="CW" />
                <Avatar initials="DK" /><Avatar initials="EM" />
              </AvatarGroup>
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Table" subtitle="Flat and opaque — no glass, no gradient behind data. Numeric columns take tabular figures.">
        <ThemePair>
          <Table caption="Recent transactions" density="compact">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Carrier</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="end" numeric>Gallons</TableHeaderCell>
                <TableHeaderCell align="end" numeric>Amount</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Northwind Freight</TableCell>
                <TableCell><Badge intent="success" size="sm">Settled</Badge></TableCell>
                <TableCell align="end" numeric>1,284.5</TableCell>
                <TableCell align="end" numeric>4,912.08</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Cascade Logistics</TableCell>
                <TableCell><Badge intent="warning" size="sm">Pending</Badge></TableCell>
                <TableCell align="end" numeric>903.0</TableCell>
                <TableCell align="end" numeric>3,447.11</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Redline Haulage</TableCell>
                <TableCell><Badge intent="danger" size="sm">Declined</Badge></TableCell>
                <TableCell align="end" numeric>0.0</TableCell>
                <TableCell align="end" numeric>0.00</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ThemePair>
      </Section>

      <Section
        title="DataTable"
        subtitle="One column definition, two renderings. Narrow the window past 900px to watch columns drop by priority, and past 640px to watch it become a tap-to-detail card list."
      >
        <Specimen label="Six columns · tap a card below 640px to open the record">
          <DataTable
            caption="Recent transactions"
            rows={DEMO_ROWS}
            rowKey={(r) => r.id}
            columns={DEMO_COLUMNS}
            density="compact"
            detail={{
              title: (r) => r.carrier,
              subtitle: (r) => `${r.unit} · ${r.date}`,
            }}
          />
        </Specimen>
        <Specimen label="Empty">
          <DataTable
            caption="Recent transactions"
            rows={[]}
            rowKey={(r: DemoRow) => r.id}
            columns={DEMO_COLUMNS}
            empty="No transactions in this period. Try widening the date range."
          />
        </Specimen>
      </Section>

      <Section title="Tabs" subtitle="Manual activation — arrows move focus, Enter activates. These panels fetch.">
        <ThemePair>
          <Tabs
            idBase="ks-tabs"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'cards', label: 'Cards', count: 12 },
              { value: 'invoices', label: 'Invoices', count: 3 },
            ]}
          >
            <TabPanel idBase="ks-tabs" value="overview">Overview panel</TabPanel>
            <TabPanel idBase="ks-tabs" value="cards">Cards panel</TabPanel>
            <TabPanel idBase="ks-tabs" value="invoices">Invoices panel</TabPanel>
          </Tabs>
        </ThemePair>
      </Section>

      <Section title="Pagination">
        <ThemePair>
          <Pagination page={page} pageCount={12} onPageChange={setPage} total={238} itemLabel="carriers" />
        </ThemePair>
      </Section>

      <Section title="Skeleton" subtitle="One loading affordance per region. Mirrors the real layout so nothing shifts.">
        <ThemePair>
          <Row>
            <Specimen label="text"><Skeleton variant="text" lines={3} /></Specimen>
            <Specimen label="circle"><Skeleton variant="circle" width="40px" height="40px" /></Specimen>
            <Specimen label="rect"><Skeleton variant="rect" width="200px" height="72px" /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      {/* ── Overlays ───────────────────────────────────────────────────── */}
      <Section title="Tooltip" subtitle="Hover AND focus both open it — a keyboard user gets the same information.">
        <ThemePair>
          <Row>
            <Specimen label="on a button">
              <Tooltip content="Re-run the last query"><Button icon="refresh" variant="ghost" aria-label="Refresh" /></Tooltip>
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="DropdownMenu" subtitle="Escape closes and returns focus to the trigger.">
        <ThemePair>
          <Row>
            <Specimen label="menu">
              <DropdownMenu
                label="Row actions"
                trigger={<Button icon="list" variant="ghost" aria-label="Row actions" />}
                items={[
                  { kind: 'label', id: 'l1', label: 'Record' },
                  { kind: 'action', id: 'open', label: 'Open', icon: 'open_in_new', onSelect: () => {} },
                  { kind: 'action', id: 'dup', label: 'Duplicate', icon: 'content_copy', onSelect: () => {} },
                  { kind: 'separator', id: 'sep1' },
                  { kind: 'action', id: 'del', label: 'Delete', icon: 'delete', destructive: true, onSelect: () => {} },
                ]}
              />
            </Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Dialog" subtitle="Native <dialog> — focus trap, inert background and Escape come from the platform.">
        <Row>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>Open destructive confirm</Button>
          <Button onClick={() => setDrawer(true)}>Open drawer</Button>
        </Row>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Edit carrier"
          subtitle="Northwind Freight · DOT 2841193"
          footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Save</Button></>}
        >
          <Input defaultValue="Northwind Freight LLC" fullWidth aria-label="Legal name" />
        </Dialog>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Suspend this carrier?"
          body="All active cards stop working immediately. This cannot be undone from here."
          confirmLabel="Suspend carrier"
          onConfirm={() => setConfirm(false)}
        />
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Transaction detail">
          <p>Drawer body content.</p>
        </Drawer>
      </Section>

      {/* ── AI-native ──────────────────────────────────────────────────── */}
      <Section title="Streaming text" subtitle="Already-painted characters are never re-animated. The caret is the only motion.">
        <ThemePair>
          <Row>
            <Specimen label="streaming"><StreamingText streaming text="Checking the last 30 days of settlements for Northwind" /></Specimen>
            <Specimen label="done"><StreamingText done text="Northwind settled 1,284.5 gallons across 14 transactions." /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Agent status" subtitle="Every state changes shape as well as colour, and carries its own label.">
        <ThemePair>
          <Row>
            <Specimen label="idle"><AgentStatus state="idle" live={false} /></Specimen>
            <Specimen label="thinking"><AgentStatus state="thinking" live={false} /></Specimen>
            <Specimen label="streaming"><AgentStatus state="streaming" live={false} /></Specimen>
            <Specimen label="tool"><AgentStatus state="tool-running" detail="dwh.query" live={false} /></Specimen>
            <Specimen label="done"><AgentStatus state="done" live={false} /></Specimen>
            <Specimen label="error"><AgentStatus state="error" live={false} /></Specimen>
          </Row>
          <Row>
            <Specimen label="badge"><AgentBadge agent="Sales" /></Specimen>
            <Specimen label="handoff"><AgentBadge agent="Billing" handoffFrom={['Orchestrator', 'Sales']} /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Tool calls" subtitle="Five states. 'denied' is RBAC refusing — not a failure, and never rendered as one.">
        <ThemePair>
          <ToolCallList
            calls={[
              { id: '1', name: 'dwh.query', status: 'ok', summary: 'gallons by carrier, 30d', elapsedMs: 412 },
              { id: '2', name: 'zoho.searchRecords', status: 'running', summary: 'module=Accounts' },
              { id: '3', name: 'cmp.moneyCode.issue', status: 'denied', summary: 'requires admin role' },
              { id: '4', name: 'efs.cardLookup', status: 'error', summary: 'upstream timeout after 30s' },
            ]}
          />
          <Row>
            <Specimen label="pending"><ToolCallCard name="dwh.query" status="pending" summary="queued" /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Citations" subtitle="An invalid citation has its own visible state — silently rendering it as valid is a trust bug.">
        <ThemePair>
          <Row>
            <Specimen label="chips">
              <CitationChip marker={1} sourceTitle="Q3 settlement report" />
              <CitationChip marker={2} sourceTitle="Carrier agreement" />
              <CitationChip marker={3} invalid sourceTitle="Missing source" />
            </Specimen>
          </Row>
          <SourceList
            sources={[
              { id: 's1', marker: 1, title: 'Q3 settlement report', detail: 'dwh.fact_settlement' },
              { id: 's2', marker: 2, title: 'Carrier agreement', url: 'https://example.com/doc' },
            ]}
          />
        </ThemePair>
      </Section>

      <Section title="Confidence" subtitle="'unknown' is not 'low' — an ungrounded answer and a low-confidence one differ.">
        <ThemePair>
          <Row>
            <Specimen label="high"><ConfidenceMeter level="high" value={0.94} /></Specimen>
            <Specimen label="med"><ConfidenceMeter level="med" value={0.61} /></Specimen>
            <Specimen label="low"><ConfidenceMeter level="low" value={0.22} /></Specimen>
            <Specimen label="unknown"><ConfidenceMeter level="unknown" /></Specimen>
          </Row>
          <Row>
            <Specimen label="verified"><Provenance state="verified" /></Specimen>
            <Specimen label="partial"><Provenance state="partial" /></Specimen>
            <Specimen label="ungrounded"><Provenance state="ungrounded" /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Inline diff" subtitle="The +/- gutter carries the meaning; red and green alone would fail a colour-blind reader.">
        <ThemePair>
          <InlineDiff
            label="deals/4417.json"
            lines={[
              { kind: 'context', text: '  "id": "4417",', before: 1, after: 1 },
              { kind: 'del', text: '  "stage": "Negotiation",', before: 2 },
              { kind: 'add', text: '  "stage": "Closed Won",', after: 2 },
              { kind: 'changed', text: '  "amount": 41200,', before: 3, after: 3 },
            ]}
          />
        </ThemePair>
      </Section>

      <Section title="Approval" subtitle="States plainly what will happen. The destructive option is never autofocused.">
        <ThemePair>
          <ApprovalBar
            action="Update deal 4417"
            summary="Set stage to Closed Won and amount to $41,200 in Zoho CRM."
            risk="high"
            approveLabel="Apply 2 changes"
            rejectLabel="Discard"
            onApprove={() => {}}
            onReject={() => {}}
          />
        </ThemePair>
      </Section>

      <Section title="Stop and retry" subtitle="Stopping is a normal action and must not look like an error.">
        <ThemePair>
          <Row>
            <Specimen label="stop"><StopButton onStop={() => {}} /></Specimen>
            <Specimen label="retry"><RetryButton onClick={() => {}} /></Specimen>
            <Specimen label="stopped"><StoppedNote /></Specimen>
          </Row>
        </ThemePair>
      </Section>

      <Section title="Turn error">
        <ThemePair>
          <TurnError
            title="The agent could not finish"
            message="dwh.query failed after 3 attempts: connection reset by peer."
          />
        </ThemePair>
      </Section>

      <Section title="Structured output" subtitle="A rendered table reuses the app's own table language — output that looks foreign reads as untrustworthy.">
        <ThemePair>
          <StructuredOutput
            blocks={[
              { kind: 'code', language: 'sql', code: 'SELECT carrier, SUM(gallons)\nFROM fact_settlement\nWHERE day >= CURRENT_DATE - 30\nGROUP BY 1;' },
              { kind: 'quote', text: 'Settlement data lags the transaction feed by up to 24 hours.' },
            ]}
          />
        </ThemePair>
      </Section>

      <Section title="Elicitation" subtitle="Once answered it becomes a read-only record of what was chosen.">
        <ThemePair>
          <ElicitationPicker
            prompt="Which fuel network should I check?"
            hint="Northwind has cards on two networks."
            options={[
              { value: 'citi', label: 'CITI Fuel', hint: '14 active cards' },
              { value: 'efs', label: 'EFS / WEX', hint: '3 active cards' },
            ]}
            onSubmit={() => {}}
          />
        </ThemePair>
      </Section>
    </KitchenShell>
  );
}
