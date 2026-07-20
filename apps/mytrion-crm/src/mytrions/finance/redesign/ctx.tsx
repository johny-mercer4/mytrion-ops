import { createContext, useContext } from 'react';

import type { Client, TransactionLine } from '../data';
import type { ClientDrillTab, DashSub, FinanceSection } from './financeData';
import type { LiveFeedItem } from './financeLive';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface FinanceCtx {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  section: FinanceSection;
  go: (next: FinanceSection) => void;
  dashSub: DashSub;
  setDashSub: (sub: DashSub) => void;
  panelKey: number;
  startAnim: () => void;
  homeLoading: boolean;
  txLoading: boolean;
  clLoading: boolean;
  dashLoading: boolean;
  liveFeed: LiveFeedItem[];
  liveNew: number;
  resetLiveNew: () => void;
  pushToast: (title: string, msg: string, type?: ToastType) => void;
  openTx: (tx: TransactionLine) => void;
  openClient: (client: Client, tab?: ClientDrillTab) => void;
  lastSync: Date;
  refreshSync: () => void;
  // Live data
  dashDebtors: any[];
  dashPayments: any[];
  fuelingMetrics: any;
  txFeed: any[];
  clientsFeed: any[];
}

export const FinanceContext = createContext<FinanceCtx | null>(null);

export function useFinanceCtx(): FinanceCtx {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinanceCtx must be used within FinanceContext');
  return ctx;
}
