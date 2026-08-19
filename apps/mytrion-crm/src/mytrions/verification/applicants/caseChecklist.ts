/**
 * "What to check", per line, with the state the reviewer has actually put it in.
 *
 * THE ASIDE USED TO CONTRADICT THE PANE. Every line was a `readOnly` checkbox bound to
 * `phase.status === 'passed'`, so on Identity and Screening — the two phases that carry real per-check
 * marks — the reviewer could mark six of seven checks OK and the aside still showed seven empty boxes,
 * then all seven filled the instant the phase passed. The list was decoration beside a form that knew
 * the answer.
 *
 * So a line now carries a STATE, and the phases that have marks derive it from them:
 *
 *   todo        nothing recorded yet
 *   done        marked OK / No match / No duplicate — this check is satisfied
 *   attention   marked Missing, Inconsistent, a possible or confirmed hit, or a duplicate. Something
 *               the reviewer has to act on, and the thing a plain tick box could never show.
 *
 * Phases with no per-check marks (Intake, Authority, Routing, Credit & banking, Highway) keep the old
 * reading — the whole list follows the phase — because for them that IS the honest answer: the sign-off
 * is the only record. They say so in their own note rather than in a footnote under every phase.
 *
 * Pure, so the mapping is testable against mark shapes rather than against a rendered aside.
 */
import type { VerificationApplicantType } from '@/api/verificationFlow';
import { AUTHORITY_CHECKS, type AuthorityMark, type AuthorityMarks } from './caseAuthority';
import { identityChecksFor, type IdentityMark } from './caseIdentity';
import { SCREENING_CHECKLIST, type ScreeningMarks } from './caseScreening';

export type ChecklistState = 'todo' | 'done' | 'attention';

export interface ChecklistLine {
  id: string;
  label: string;
  state: ChecklistState;
  /**
   * WHICH KIND of attention, so the aside and the pane agree in colour.
   *
   * `attention` covers two different marks: an ASK (Missing — request the document, amber) and a
   * FINDING (Inconsistent, a possible or confirmed hit, a duplicate — red). The pane already paints
   * those differently, so an aside that showed one amber tone for both was two panels disagreeing about
   * the same row. Defaults to `warn` when a state has no tone of its own.
   */
  tone?: 'warn' | 'bad';
  /** Why it needs attention, in the reviewer's own words. Absent on `todo` and `done`. */
  note?: string;
}

/** Whether a phase's lines are driven by marks the reviewer sets, or only by its sign-off. */
export function checklistIsLive(phaseCode: string): boolean {
  return (
    phaseCode === 'p2_identity' || phaseCode === 'p3_screening' || phaseCode === 'p4_authority'
  );
}

const IDENTITY_STATE: Record<
  IdentityMark,
  { state: ChecklistState; tone?: 'warn' | 'bad'; note?: string }
> = {
  ok: { state: 'done' },
  missing: { state: 'attention', tone: 'warn', note: 'Marked missing — request the document' },
  inconsistent: { state: 'attention', tone: 'bad', note: 'Marked inconsistent with the file' },
};

function identityLines(
  applicantType: VerificationApplicantType | null,
  marks: Record<string, IdentityMark>,
): ChecklistLine[] {
  return identityChecksFor(applicantType).map((check) => {
    const mark = marks[check.id];
    const mapped = mark ? IDENTITY_STATE[mark] : null;
    return {
      id: check.id,
      label: check.label,
      state: mapped?.state ?? 'todo',
      ...(mapped?.tone ? { tone: mapped.tone } : {}),
      ...(mapped?.note ? { note: mapped.note } : {}),
    };
  });
}

function screeningLines(marks: ScreeningMarks): ChecklistLine[] {
  const blacklist: ChecklistLine =
    marks.blacklist === 'none'
      ? { id: 'blacklist', label: SCREENING_CHECKLIST[0]!, state: 'done' }
      : marks.blacklist === 'possible'
        ? {
            id: 'blacklist',
            label: SCREENING_CHECKLIST[0]!,
            state: 'attention',
            tone: 'warn',
            note: 'Possible match — resolve it before passing',
          }
        : marks.blacklist === 'confirmed'
          ? {
              id: 'blacklist',
              label: SCREENING_CHECKLIST[0]!,
              state: 'attention',
              tone: 'bad',
              note: 'Confirmed match — this declines and informs Collections',
            }
          : { id: 'blacklist', label: SCREENING_CHECKLIST[0]!, state: 'todo' };

  const duplicate: ChecklistLine =
    marks.duplicate === 'no'
      ? { id: 'duplicate', label: SCREENING_CHECKLIST[1]!, state: 'done' }
      : marks.duplicate === 'yes'
        ? {
            id: 'duplicate',
            label: SCREENING_CHECKLIST[1]!,
            state: 'attention',
            tone: 'bad',
            note: 'Already a customer, or a duplicate application',
          }
        : { id: 'duplicate', label: SCREENING_CHECKLIST[1]!, state: 'todo' };

  return [blacklist, duplicate];
}

/**
 * Phase 4's own mark vocabulary. `missing` is an ASK (amber, requests the document from Sales);
 * `inactive` is a FINDING about the authority and `unresolved` is the reviewer saying they could not
 * settle it — both red, both a manager's problem, which is what the SOP does with them.
 */
const AUTHORITY_STATE: Record<
  AuthorityMark,
  { state: ChecklistState; tone?: 'warn' | 'bad'; note?: string }
> = {
  ok: { state: 'done' },
  inactive: { state: 'attention', tone: 'bad', note: 'Not active — this goes to Manager Review' },
  missing: { state: 'attention', tone: 'warn', note: 'Marked missing — request the document' },
  unresolved: { state: 'attention', tone: 'bad', note: 'Unresolved — a manager has to rule on it' },
};

function authorityLines(marks: AuthorityMarks): ChecklistLine[] {
  const lines: ChecklistLine[] = AUTHORITY_CHECKS.map((check) => {
    const mark = marks.checks[check.id];
    const mapped = mark ? AUTHORITY_STATE[mark] : null;
    return {
      id: check.id,
      label: check.label,
      state: mapped?.state ?? 'todo',
      ...(mapped?.tone ? { tone: mapped.tone } : {}),
      ...(mapped?.note ? { note: mapped.note } : {}),
    };
  });

  /**
   * The two structure questions. `na` counts as DONE — "does not apply to this applicant" is an answer,
   * and leaving it outstanding would make a clean carrier read as two checks short forever.
   */
  const structure = (
    id: string,
    label: string,
    mark: AuthorityMarks['relatedCompany'],
    doc: string,
  ): ChecklistLine =>
    mark === 'needed'
      ? { id, label, state: 'attention', tone: 'warn', note: `${doc} requested from Sales` }
      : mark
        ? { id, label, state: 'done' }
        : { id, label, state: 'todo' };

  lines.push(
    structure(
      'related_company',
      'Related-company structure — Corporate Guarantee',
      marks.relatedCompany,
      'Corporate guarantee',
    ),
    structure(
      'third_party',
      'Third-party carrier — Lease agreement and unit info',
      marks.thirdParty,
      'Lease agreement',
    ),
  );
  return lines;
}

/**
 * The lines for a phase.
 *
 * `passed` wins over the marks on a phase already signed off: the marks live in component state and
 * are empty on a fresh mount, so a passed phase read from them alone would show its whole list as
 * outstanding. The recorded decision is the stronger fact.
 */
export function checklistLines(input: {
  phaseCode: string;
  phasePassed: boolean;
  labels: readonly string[];
  applicantType: VerificationApplicantType | null;
  identityMarks: Record<string, IdentityMark>;
  screeningMarks: ScreeningMarks;
  authorityMarks: AuthorityMarks;
}): ChecklistLine[] {
  if (!input.phasePassed && input.phaseCode === 'p2_identity') {
    return identityLines(input.applicantType, input.identityMarks);
  }
  if (!input.phasePassed && input.phaseCode === 'p3_screening') {
    return screeningLines(input.screeningMarks);
  }
  if (!input.phasePassed && input.phaseCode === 'p4_authority') {
    return authorityLines(input.authorityMarks);
  }
  return input.labels.map((label, i) => ({
    id: `${input.phaseCode}:${i}`,
    label,
    state: input.phasePassed ? 'done' : 'todo',
  }));
}

/** `3 of 7` for the aside's head — counted over the lines actually shown. */
export function checklistProgress(lines: readonly ChecklistLine[]): {
  done: number;
  attention: number;
  total: number;
} {
  return {
    done: lines.filter((l) => l.state === 'done').length,
    attention: lines.filter((l) => l.state === 'attention').length,
    total: lines.length,
  };
}
