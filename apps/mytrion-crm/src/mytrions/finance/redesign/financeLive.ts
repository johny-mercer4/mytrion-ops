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

export function buildLiveItem(t: any, isNew: boolean): LiveFeedItem {
  return {
    key: `${t.txId}-${Math.random()}`,
    company: t.company || '',
    meta: `${t.loc || ''}, ${t.state || ''}`,
    amount: fmtCurrency(t.amount || 0).replace('.00', ''),
    grade: t.grade || '',
    time: isNew ? 'now' : relTime(new Date(t.date || Date.now()).getTime()),
    flash: isNew,
  };
}

export function seedLiveFeed(): LiveFeedItem[] {
  return [];
}
