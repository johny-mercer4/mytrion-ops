/**
 * Phase 4 — Authority & Operating Status, automated.
 *
 * WHAT THE SOP ASKS FOR, and where each answer comes from. Verify MC status, USDOT status, operating
 * authority, insurance status and operating history; active continues, inactive goes to Manager
 * Review, missing documents park on Pending Documents.
 *
 *  | Check              | Source of truth        | Reachable off-Render? |
 *  | ---                | ---                    | --- |
 *  | USDOT status       | QCMobile `statusCode`  | via Socrata census `status_code` |
 *  | Operating authority| QCMobile `/authority`  | via census `docket1..3_status_code` |
 *  | MC status          | QCMobile docket lookup | via census `docket1prefix` + `docket1` |
 *  | Insurance          | QCMobile `*InsuranceOnFile` | NO — the Socrata feed is frozen |
 *  | Authority age      | census `add_date`      | yes |
 *  | Operating history  | a human               | never |
 *
 * THREE SOURCES, AND THE POINT IS THAT THEY DISAGREE USEFULLY. QCMobile is the register of record but
 * every fmcsa.dot.gov host denies non-US egress at the edge, so it answers only from the US Render
 * instance. The Socrata census is third-party SaaS, answers from anywhere, and covers everything above
 * except insurance. The DWH broker snapshot is already read by this pane and stays — it matched about a
 * quarter of cases when measured, so it is a third opinion, never a dependency.
 *
 * NOTHING HERE DECIDES. Every probe returns `{ available, error, ... }`, every flag lands on the phase
 * findings, and the pane turns them into SUGGESTIONS a credit agent applies by hand. An automation that
 * marked a check would put a reviewer's name against work they did not do.
 */
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { VERIFICATION_PHASE, type VerificationCase } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { AppError } from '../../lib/errors.js';
import {
  fetchFmcsaAuthority,
  isFmcsaConfigured,
  lookupFmcsaCarrier,
} from '../../integrations/fmcsaQcMobile.js';
import { fetchCensusByDot } from '../../integrations/socrataFmcsa.js';
import {
  fetchInsuranceByDot,
  SOCRATA_BIPD_FORM_CODE,
} from '../../integrations/socrataFmcsaFilings.js';

/**
 * Digits only, non-zero, at least five long.
 *
 * FIVE, not four and not six. Our own 52 cases carry `221` and `2231` in the USDOT column
 * (owner-operator junk in the wrong box) and `carrierEnrich.ts` gates at four, which lets `2231`
 * through. Six would be worse in the other direction: the FMCSA census holds 50,410 real five-digit
 * USDOTs, so a six-digit floor refuses tens of thousands of genuine carriers. Five is the smallest
 * floor that excludes every junk value measured.
 */
const MIN_KEY_DIGITS = 5;

function usableNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '');
  if (digits.length < MIN_KEY_DIGITS || Number(digits) === 0) return null;
  return digits;
}

/**
 * The lookup keys for one case, in the order the register should be asked.
 *
 * `carrier_dot` IS included, third. It is snapshot-derived rather than applicant-supplied, so its own
 * hit rate is circular — but it exists on three cases that have no `dot` at all, and it DISAGREES with
 * `dot` on four. That disagreement is a signal (Zoho's DOT box holding an MC, or a wrong number), so
 * it is surfaced rather than used to silently break a tie.
 */
export interface AuthorityKeys {
  dot: string | null;
  mc: string | null;
  carrierDot: string | null;
  companyName: string | null;
  /** True when `dot` and `mc` are the same digits — 10 of our 15 both-filled rows are. */
  authorityNumbersIdentical: boolean;
}

export function authorityKeysFor(row: VerificationCase): AuthorityKeys {
  const dot = usableNumber(row.dot);
  const mc = usableNumber(row.mc);
  return {
    dot,
    mc,
    carrierDot: usableNumber(row.carrierDot),
    companyName: (row.companyName ?? '').trim() || null,
    authorityNumbersIdentical: dot !== null && dot === mc,
  };
}

/** Which USDOT the census and insurance probes should use, and why that one. */
function censusDot(keys: AuthorityKeys): { dot: string | null; from: 'dot' | 'carrier_dot' | null } {
  if (keys.dot !== null) return { dot: keys.dot, from: 'dot' };
  if (keys.carrierDot !== null) return { dot: keys.carrierDot, from: 'carrier_dot' };
  return { dot: null, from: null };
}

/**
 * Run every authority source for one case and store the findings.
 *
 * REFUSES A NON-CARRIER, LOUDLY. `p4_authority` is carrier-only — an owner-operator IS the person and
 * holds no authority to verify — and `buildRail` still renders `findings` for a phase whose `applies`
 * is false, so writing a blob here would put an FMCSA panel underneath "Not applicable". A 409 is the
 * honest answer; the pane never offers the control in the first place.
 */
export async function runAuthorityLookup(ctx: TenantContext, row: VerificationCase): Promise<void> {
  if (row.applicantType !== 'carrier') {
    throw new AppError(
      'Authority and operating status apply to carriers only — this applicant holds no MC or USDOT authority to verify.',
      { statusCode: 409, code: 'VERIFICATION_PHASE_NOT_APPLICABLE', expose: true },
    );
  }

  const keys = authorityKeysFor(row);
  const census = censusDot(keys);

  /**
   * FOUR READS, FANNED OUT, and none allowed to speak for the others.
   *
   * `Promise.all` over probes that never throw: one unreachable source must not cost the other three,
   * which is exactly the situation off-Render, where QCMobile is denied and Socrata answers fine.
   * The two Socrata reads are skipped rather than sent when there is no usable USDOT — Socrata would
   * answer `[]` with HTTP 200 and that reads as "nothing on file" for a carrier we never asked about.
   */
  const [carrier, authority, censusRecord, insurance] = await Promise.all([
    lookupFmcsaCarrier({ dot: keys.dot, mc: keys.mc, name: keys.companyName }),
    keys.dot !== null
      ? fetchFmcsaAuthority(keys.dot)
      : Promise.resolve({
          available: false as const,
          error: 'no usable USDOT for an authority lookup',
          reason: null,
          records: [],
        }),
    census.dot !== null
      ? fetchCensusByDot(census.dot)
      : Promise.resolve({
          available: false as const,
          error: 'no usable USDOT for a census lookup',
          record: null,
        }),
    census.dot !== null
      ? fetchInsuranceByDot(census.dot)
      : Promise.resolve({
          available: false as const,
          error: 'no usable USDOT for an insurance lookup',
          frozen: true as const,
          dataAsOf: '',
          filings: [],
        }),
  ]);

  /**
   * The BIPD liability filings only, and only the ones still standing.
   *
   * `91X` is the form that decides whether a carrier is legally on the road. Compared against the
   * exported constant because the stored codes carry NO `BMC-` prefix — `BMC-91X`, which is what the
   * form is actually titled, matches nothing and returns an empty page.
   */
  const bipd = insurance.filings.filter(
    (filing) => filing.formCode === SOCRATA_BIPD_FORM_CODE && filing.status === 'active',
  );

  await verificationCaseAssetRepo.recordPhaseObservation(ctx, row.id, {
    phaseCode: VERIFICATION_PHASE.authority,
    status: 'in_progress',
    findings: {
      ranAt: new Date().toISOString(),
      keys: {
        dot: keys.dot,
        mc: keys.mc,
        carrierDot: keys.carrierDot,
        censusDotFrom: census.from,
        // 10 of 15 both-filled cases have identical digits, so "has both" is not two keys. Surfaced
        // because it changes what a reviewer should read into an MC that agrees with the USDOT.
        authorityNumbersIdentical: keys.authorityNumbersIdentical,
        // A DOT and a snapshot-derived DOT that disagree is a signal about the application, not noise.
        carrierDotDisagrees:
          keys.dot !== null && keys.carrierDot !== null && keys.dot !== keys.carrierDot,
      },
      /**
       * WHETHER EACH SOURCE WAS ACTUALLY READ.
       *
       * `reason: 'blocked'` is the one the desk most needs spelled out: it means the FMCSA edge denied
       * this egress IP, which is permanent off-Render and says nothing whatever about the carrier. A
       * pane that rendered it as an absence of findings would be reporting a clear it never obtained.
       */
      register: {
        source: 'fmcsa.qcmobile',
        configured: isFmcsaConfigured(),
        available: carrier.available,
        error: carrier.error,
        reason: carrier.reason,
        notFound: carrier.notFound,
        matchedOn: carrier.matchedOn,
        carrier: carrier.carrier,
        candidates: carrier.candidates,
        candidatesTruncated: carrier.candidatesTruncated,
        retrievalDate: carrier.retrievalDate,
      },
      operatingAuthority: {
        source: 'fmcsa.qcmobile/authority',
        available: authority.available,
        error: authority.error,
        records: authority.records,
      },
      census: {
        source: 'socrata.az4n-8mr2',
        // The one LIVE source here: refreshed to within days, unlike the two below.
        frozen: false,
        available: censusRecord.available,
        error: censusRecord.error,
        record: censusRecord.record,
      },
      insurance: {
        source: 'socrata.qh9u-swkp',
        /**
         * FROZEN, AND THE DESK MUST SAY SO. This feed stopped updating on `dataAsOf` and only looks
         * fresh because Socrata republishes it wholesale. 4.7% of carriers that read as insured at the
         * cutoff have already passed their scheduled cancellation date. Live insurance status is
         * QCMobile's `*InsuranceOnFile` amounts; this is corroboration and history.
         */
        frozen: true,
        dataAsOf: insurance.dataAsOf,
        available: insurance.available,
        error: insurance.error,
        bipdActive: bipd.length,
        bipdCoverageDollars: bipd[0]?.maxCoverageDollars ?? null,
        filings: insurance.filings,
      },
    },
  });
}
