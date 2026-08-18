/**
 * Form values and attachments are two stores. Mixing them is what wiped typed fields
 * after every upload: the document routes return a full ApplicationDetail, and reseeding
 * the form from that payload replaced whatever the agent had typed but not saved.
 *
 * Completeness for Submit is still the server's. The helpers here only decide what the
 * agent sees (red on an empty required input; the document list after a file write).
 */
import type {
  ApplicationDetail,
  VerificationDocument,
  VerificationMissingItem,
} from '@/api/verificationFlow';

/** Fields the agent can satisfy by typing. Documents / principals stay server-flagged. */
export const FORM_BACKED_FIELDS: ReadonlySet<string> = new Set([
  'firstName',
  'lastName',
  'dateOfBirth',
  'residentialAddress',
  'ssnLast4',
  'dlLast4',
  'dlState',
  'companyName',
  'ein',
  'mc',
  'dot',
  'businessAddress',
  'email',
  'phone',
  'trucksCount',
  'fuelCardsRequested',
  'requestedLimit',
]);

export function formFromCase(c: ApplicationDetail['case']): Record<string, string> {
  return {
    companyName: (c.companyName as string) ?? '',
    firstName: (c.firstName as string) ?? '',
    lastName: (c.lastName as string) ?? '',
    email: (c.email as string) ?? '',
    phone: (c.phone as string) ?? '',
    dateOfBirth: (c.dateOfBirth as string) ?? '',
    ssnLast4: (c.ssnLast4 as string) ?? '',
    dlLast4: (c.dlLast4 as string) ?? '',
    dlState: (c.dlState as string) ?? '',
    residentialAddress: (c.residentialAddress as string) ?? '',
    businessAddress: (c.businessAddress as string) ?? '',
    ein: (c.ein as string) ?? '',
    mc: (c.mc as string) ?? '',
    dot: (c.dot as string) ?? '',
    trucksCount: c.trucksCount == null ? '' : String(c.trucksCount),
    fuelCardsRequested: c.fuelCardsRequested == null ? '' : String(c.fuelCardsRequested),
    requestedLimit: (c.requestedLimit as string) ?? '',
    bankingSource: (c.bankingSource as string) ?? 'statements',
  };
}

export function fieldVisiblyMissing(
  serverMissing: ReadonlySet<string>,
  field: string,
  value: string,
): boolean {
  return serverMissing.has(field) && value.trim().length === 0;
}

export function visibleMissingItems(
  missing: readonly VerificationMissingItem[],
  form: Record<string, string>,
): VerificationMissingItem[] {
  return missing.filter((item) => {
    if (!FORM_BACKED_FIELDS.has(item.field)) return true;
    return String(form[item.field] ?? '').trim().length === 0;
  });
}

/** Union by id so a slower upload cannot drop a file a faster one already added. */
export function mergeDocuments(
  prev: readonly VerificationDocument[],
  next: readonly VerificationDocument[],
): VerificationDocument[] {
  const byId = new Map(prev.map((doc) => [doc.id, doc]));
  for (const doc of next) byId.set(doc.id, doc);
  return [...byId.values()];
}

/**
 * Server list wins for ids it still has; keep local extras (an in-flight upload that
 * the delete response has not seen yet); never put the deleted id back.
 */
export function documentsAfterDelete(
  prev: readonly VerificationDocument[],
  next: readonly VerificationDocument[],
  deletedId: string,
): VerificationDocument[] {
  const fromServer = next.filter((doc) => doc.id !== deletedId);
  const extra = prev.filter(
    (doc) => doc.id !== deletedId && !fromServer.some((row) => row.id === doc.id),
  );
  return [...fromServer, ...extra];
}

export type CaseSurface = 'intake' | 'ready' | 'in_progress' | 'needs_more' | 'complete';

export function caseSurface(detail: ApplicationDetail): CaseSurface {
  if (detail.case.closedAt) return 'complete';
  if (detail.case.statusCode === 'pending_docs') return 'needs_more';
  if (detail.case.verificationProcess) return 'in_progress';
  if (detail.intake.complete) return 'ready';
  return 'intake';
}

export function caseDisplayName(c: ApplicationDetail['case']): string {
  return (
    (c.companyName as string) ||
    [c.firstName, c.lastName].filter(Boolean).join(' ') ||
    'Untitled application'
  );
}

export function applicantTypeLabel(type: ApplicationDetail['case']['applicantType']): string {
  if (type === 'owner_operator') return 'Owner-Operator / Individual';
  if (type === 'carrier' || type === 'company') return 'Carrier (Company)';
  return 'Type not set';
}

/** The two types Sales can pick. `company` is shown as Carrier. */
export const APPLICANT_TYPE_OPTIONS: ReadonlyArray<{
  value: 'owner_operator' | 'carrier';
  label: string;
}> = [
  { value: 'owner_operator', label: 'Owner-Operator / Individual' },
  { value: 'carrier', label: 'Carrier (Company)' },
];

export function applicantTypeSelectValue(
  type: ApplicationDetail['case']['applicantType'],
): 'owner_operator' | 'carrier' {
  return type === 'owner_operator' ? 'owner_operator' : 'carrier';
}

const MATCHED_ON_LABEL: Record<'phone' | 'dot' | 'email', string> = {
  phone: 'phone number',
  dot: 'USDOT number',
  email: 'email address',
};

/**
 * Prefill subtitle. A warehouse hit is a suggestion, not a type decision.
 *
 * FMCSA `operating_status` is company-authority language ("AUTHORIZED FOR PROPERTY"). Prefixing
 * it with "authority" produced "authority authorized for property", and showing that line on an
 * owner-operator case implied the match had already chosen Carrier.
 */
export function prefillMatchLine(
  match: {
    matchedOn: 'phone' | 'dot' | 'email';
    operatingStatus: string | null;
    authorityAddedOn: string | null;
  },
  applicantType: ApplicationDetail['case']['applicantType'],
): string {
  const bits = [`matched on ${MATCHED_ON_LABEL[match.matchedOn]}`];
  const company = applicantType === 'carrier' || applicantType === 'company';
  if (!company) return bits[0]!;
  const status = (match.operatingStatus ?? '').trim().toLowerCase();
  if (!status) return bits[0]!;
  const year = match.authorityAddedOn?.slice(0, 4);
  bits.push(year ? `${status} since ${year}` : status);
  return bits.join(' · ');
}
