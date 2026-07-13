/**
 * Shared shell context for the Sales Mytrion redesign. The shell owns cross-tab chrome
 * (theme, toast, the detail + client modals, the AI copilot); each tab is a self-contained
 * component that reads this context for those affordances and otherwise manages its own
 * local state — matching the reference prototype's behavior with a cleaner React shape.
 */
import { createContext, useContext } from 'react';
import type { BadgeVM } from './salesData';
import type { DealVM, LeadVM } from './dataCenterLive';

/** A detail-modal payload (announcements, inbox items). */
export interface DetailVM {
  title: string;
  body: string;
  icon: string;
  iconStyle: string;
  metaLabel: string;
  meta: string;
  badges: BadgeVM[];
}

/** A client record for the client drilldown modal. */
export interface ClientRecord {
  id: string;
  name: string;
  carrier: string;
  contact: string;
  phone: string;
  cards: number;
  active: number;
  gallons: string;
  balance: string;
  status: 'active' | 'attention' | 'debtor';
  mc: string;
  dot: string;
}

export interface SalesCtx {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  pushToast: (title: string, msg: string) => void;
  openDetail: (d: DetailVM) => void;
  openClient: (c: ClientRecord) => void;
  /** Data Center drilldowns — the lead / deal detail modals (owned by the shell). */
  openLead: (l: LeadVM) => void;
  openDeal: (d: DealVM) => void;
  /** Jump to another tab (e.g. Home CTA → Automations). */
  go: (section: string) => void;
  /** Jump to the Tickets tab and auto-open a specific ticket (e.g. after Create). */
  openTicket: (ticketId: string) => void;
  /** The ticket the Tickets tab should auto-select on entry (consumed via clearFocusTicket). */
  focusTicketId: string | null;
  clearFocusTicket: () => void;
}

export const SalesContext = createContext<SalesCtx | null>(null);

export function useSales(): SalesCtx {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error('useSales must be used inside the Sales redesign shell');
  return ctx;
}
