import { createContext, useContext } from 'react';

import type { Client, TransactionLine } from '../data';
import type { ClientDrillTab, DashSub, FinanceSection } from './financeData';

export interface FinanceCtx {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  section: FinanceSection;
  go: (next: FinanceSection) => void;
  dashSub: DashSub;
  setDashSub: (sub: DashSub) => void;
  pushToast: (title: string, msg: string) => void;
  openTx: (tx: TransactionLine) => void;
  openClient: (client: Client, tab?: ClientDrillTab) => void;
  lastSync: Date;
  refreshSync: () => void;
}

export const FinanceContext = createContext<FinanceCtx | null>(null);

export function useFinanceCtx(): FinanceCtx {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinanceCtx must be used within FinanceContext');
  return ctx;
}
