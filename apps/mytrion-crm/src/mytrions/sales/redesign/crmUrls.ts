/**
 * Zoho CRM deep links (widget parity — octanefuel org). Used after create-lead / duplicate
 * so agents can open the record in CRM without hunting for it.
 */
const CRM_ORG = 'https://crm.zoho.com/crm/octanefuel';

/** Carrier Search panel shape: `/tab/Leads/{id}`. */
export function zohoLeadUrl(leadId: string): string {
  return `${CRM_ORG}/tab/Leads/${encodeURIComponent(leadId)}`;
}

export function leadShortId(leadId: string): string {
  return leadId.length > 6 ? leadId.slice(-6) : leadId;
}
