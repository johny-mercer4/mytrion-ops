import type { CrmRow, ReferralCalculationPreview, ReferralWorkspace } from '../../../api/referrals';

export interface ReferralCardModel {
  id: string;
  parent: CrmRow;
  children: CrmRow[];
  deals: CrmRow[];
  leads: CrmRow[];
  previews: ReferralCalculationPreview[];
  calculation: string;
  referrerId: string;
  name: string;
  company: string;
  payableAmount: number;
  searchText: string;
  setupState: 'ready' | 'needs_calculation' | 'needs_child' | 'needs_deal';
}

export function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function lookupId(row: CrmRow, field: string): string {
  const value = row[field];
  return value && typeof value === 'object' && 'id' in value
    ? str((value as { id?: unknown }).id)
    : '';
}

export function displayValue(value: unknown): { text: string; href?: string; empty?: boolean } {
  if (value === null || value === undefined || value === '')
    return { text: 'Not provided', empty: true };
  if (typeof value === 'boolean') return { text: value ? 'Yes' : 'No' };
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.name != null) return { text: str(record.name) };
    if (record.id != null) return { text: str(record.id) };
    return { text: JSON.stringify(value) };
  }
  const text = String(value);
  return /^https?:\/\//i.test(text) ? { text, href: text } : { text };
}

function rowText(row: CrmRow): string {
  return Object.values(row)
    .map((value) => displayValue(value).text)
    .join(' \u0000 ')
    .toLowerCase();
}

/** Parent cards with all related modal records already grouped. */
export function buildReferralCards(workspace: ReferralWorkspace): {
  cards: ReferralCardModel[];
  orphanChildren: CrmRow[];
} {
  const parents = workspace.parents.rows;
  const children = workspace.children.rows;
  const deals = workspace.associations.deals.rows;
  const leads = workspace.associations.leads.rows;

  const matchedChildren = new Set<string>();
  const cards = parents.map((parent): ReferralCardModel => {
    const id = str(parent.id);
    const referrerId = str(parent.ReferrerId);
    const childRows = children.filter((child) => {
      const matched =
        lookupId(child, 'Parent_Referrer') === id ||
        (referrerId !== '' && str(child.Referrer_ID) === referrerId);
      if (matched) matchedChildren.add(str(child.id));
      return matched;
    });
    const childIds = new Set(childRows.map((child) => str(child.id)));
    const dealRows = deals.filter(
      (deal) =>
        lookupId(deal, 'Parent_Referrer') === id || childIds.has(lookupId(deal, 'Child_Referrer')),
    );
    const leadRows = leads.filter(
      (lead) =>
        lookupId(lead, 'Parent_Referrer') === id || childIds.has(lookupId(lead, 'Child_Referrer')),
    );
    const previews = workspace.previews.filter((preview) => preview.parentId === id);
    const calculation = str(parent.Calculation);
    const setupState: ReferralCardModel['setupState'] =
      !calculation || calculation === '-None-'
        ? 'needs_calculation'
        : childRows.length === 0
          ? 'needs_child'
          : previews.length === 0
            ? 'needs_deal'
            : 'ready';
    const name = str(parent.Name) || str(parent.Full_Name) || 'Unnamed referrer';
    const company = str(parent.Company_Name);
    const payableAmount = previews.reduce(
      (sum, preview) => sum + Number(preview.payableAmountUsd || 0),
      0,
    );
    return {
      id,
      parent,
      children: childRows,
      deals: dealRows,
      leads: leadRows,
      previews,
      calculation,
      referrerId,
      name,
      company,
      payableAmount,
      setupState,
      searchText: [
        rowText(parent),
        ...childRows.map(rowText),
        ...dealRows.map(rowText),
        ...leadRows.map(rowText),
      ].join(' \u0001 '),
    };
  });

  return {
    cards,
    orphanChildren: children.filter((child) => !matchedChildren.has(str(child.id))),
  };
}

export function cardMatchesFilter(card: ReferralCardModel, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs_setup') return card.setupState !== 'ready';
  return card.calculation === filter;
}
