import { TRANSACTION_LINES, type TransactionLine } from '../data';
import { fmtCurrency, relTime } from './financeData';

export interface LiveFeedItem {
  key: string;
  company: string;
  meta: string;
  amount: string;
  grade: string;
  time: string;
  flash: boolean;
}

export function buildLiveItem(t: TransactionLine, isNew: boolean): LiveFeedItem {
  return {
    key: `${t.txId}-${Math.random()}`,
    company: t.company,
    meta: `${t.loc}, ${t.state}`,
    amount: fmtCurrency(t.amount).replace('.00', ''),
    grade: t.grade,
    time: isNew ? 'now' : relTime(new Date(t.date).getTime()),
    flash: isNew,
  };
}

export function seedLiveFeed(): LiveFeedItem[] {
  return TRANSACTION_LINES.slice(0, 5).map((t) => buildLiveItem(t, false));
}

export function pickRandomTx(): TransactionLine {
  if (TRANSACTION_LINES.length === 0) {
    throw new Error('TRANSACTION_LINES is empty');
  }
  const idx = Math.floor(Math.random() * TRANSACTION_LINES.length);
  const line = TRANSACTION_LINES[idx];
  if (!line) {
    throw new Error('TRANSACTION_LINES is empty');
  }
  return line;
}
