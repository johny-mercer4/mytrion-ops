/**
 * The two owners are different people, and only one of them is in Sales.
 *
 * This existed as a live defect: three of twenty-three cases carried `owner_name: 'Sarvar Asqarov'`,
 * the Verification desk's own credit agent, because `createApplicationFromDeal` falls back to
 * `VERIFICATION_CASE_OWNER_NAME` when a Deal reaches us unowned. Every screen that said "Sales owner"
 * read that column, so the desk was told to chase a colleague for intake nobody in Sales owed.
 */
import { describe, expect, it } from 'vitest';
import {
  salesOwnerId,
  salesOwnerLabel,
  salesOwnerName,
  UNASSIGNED_SALES_OWNER,
  verificationOwnerName,
} from './verificationSalesOwner';

/** The real shape of a case whose Deal arrived unowned: assignee = the Verification agent. */
const FELL_BACK_TO_VERIFICATION = {
  ownerName: 'Sarvar Asqarov',
  ownerZohoUserId: '6227679000088272001',
  zohoOwnerName: null,
  zohoOwnerId: null,
};

/** The normal shape: the Deal's owner is a Sales agent, and the assignee mirrors them. */
const OWNED_BY_SALES = {
  ownerName: 'Robert Toms',
  ownerZohoUserId: '6227679000138228393',
  zohoOwnerName: 'Robert Toms',
  zohoOwnerId: '6227679000138228393',
};

/** Reassigned in Zoho after ingest: the assignee is stale, the Deal owner is current. */
const REASSIGNED = {
  ownerName: 'Sarvar Asqarov',
  ownerZohoUserId: '6227679000088272001',
  zohoOwnerName: 'Robert Toms',
  zohoOwnerId: '6227679000138228393',
};

describe('the Sales owner is the Deal owner', () => {
  it('reads the Deal owner, never the assignee', () => {
    expect(salesOwnerName(OWNED_BY_SALES)).toBe('Robert Toms');
    expect(salesOwnerId(OWNED_BY_SALES)).toBe('6227679000138228393');
  });

  it('does not name the Verification agent when the assignee is one', () => {
    // The whole bug in one assertion.
    expect(salesOwnerName(REASSIGNED)).toBe('Robert Toms');
    expect(salesOwnerName(REASSIGNED)).not.toBe('Sarvar Asqarov');
    expect(salesOwnerId(REASSIGNED)).toBe('6227679000138228393');
  });

  it('reports an unowned Deal rather than borrowing the assignee', () => {
    expect(salesOwnerName(FELL_BACK_TO_VERIFICATION)).toBeNull();
    expect(salesOwnerId(FELL_BACK_TO_VERIFICATION)).toBeNull();
    expect(salesOwnerLabel(FELL_BACK_TO_VERIFICATION)).toBe(UNASSIGNED_SALES_OWNER);
    expect(salesOwnerLabel(FELL_BACK_TO_VERIFICATION)).not.toContain('Sarvar');
  });

  it('treats blank strings as no owner — Zoho sends those for a cleared lookup', () => {
    expect(salesOwnerName({ zohoOwnerName: '   ' })).toBeNull();
    expect(salesOwnerId({ zohoOwnerId: '' })).toBeNull();
    expect(salesOwnerLabel({ zohoOwnerName: '' })).toBe(UNASSIGNED_SALES_OWNER);
  });

  it('trims, so a padded lookup name does not break an initials or equality check', () => {
    expect(salesOwnerName({ zohoOwnerName: ' Robert Toms ' })).toBe('Robert Toms');
    expect(salesOwnerId({ zohoOwnerId: ' 42 ' })).toBe('42');
  });
});

/**
 * The verification agent. Two sources: the row's own credit agent when one was assigned, else the
 * desk's configured agent. The failure to avoid is the mirror of the Sales-owner bug — printing a
 * Sales agent's name under a Verification heading on the rows where the assignee is just a copy of
 * the Deal owner.
 */
describe('the verification agent', () => {
  const DESK = 'Sarvar Asqarov';

  it('names the credit agent the row was actually assigned to', () => {
    expect(verificationOwnerName(FELL_BACK_TO_VERIFICATION, DESK)).toBe('Sarvar Asqarov');
    expect(verificationOwnerName(REASSIGNED, DESK)).toBe('Sarvar Asqarov');
  });

  it('falls back to the desk agent, never to the Sales agent', () => {
    // The live shape for twenty-one of twenty-four cases: the assignee is a copy of the Deal owner.
    expect(verificationOwnerName(OWNED_BY_SALES, DESK)).toBe(DESK);
    expect(verificationOwnerName(OWNED_BY_SALES, DESK)).not.toBe('Robert Toms');
  });

  /**
   * Stage-0 routing writes a REAL per-case assignee, and it outranks everything else.
   *
   * Before it existed the desk chip printed the tenant's one configured credit agent on every case
   * alike, because there was no finer truth to read. Now there is, and a case routed to the second
   * credit agent must say so — otherwise the rotation is invisible to the desk it is rotating.
   */
  it('prefers the routed credit agent over the desk fallback', () => {
    const routed = {
      ...OWNED_BY_SALES,
      verificationOwnerZohoUserId: '980006',
      verificationOwnerName: 'Nodira Yusupova',
    };
    expect(verificationOwnerName(routed, DESK)).toBe('Nodira Yusupova');
    // And a blank routed name is absent, not an empty label — fall through, never print nothing.
    expect(verificationOwnerName({ ...routed, verificationOwnerName: '  ' }, DESK)).toBe(DESK);
  });

  it('excludes the Sales agent by NAME too, not only by id', () => {
    // One of the two ids missing must not be enough to leak the Sales name through.
    expect(verificationOwnerName({ ownerName: 'Robert Toms', zohoOwnerName: 'Robert Toms' }, DESK)).toBe(DESK);
    expect(
      verificationOwnerName(
        { ownerName: 'Robert Toms', ownerZohoUserId: '1', zohoOwnerName: 'Robert Toms' },
        DESK,
      ),
    ).toBe(DESK);
  });

  it('returns null when the desk agent is unknown, so callers render nothing', () => {
    // A placeholder word here sat under a Sales agent's name and read as if it described him.
    expect(verificationOwnerName(OWNED_BY_SALES, null)).toBeNull();
    expect(verificationOwnerName({ zohoOwnerName: 'Robert Toms' }, null)).toBeNull();
    expect(verificationOwnerName({}, '  ')).toBeNull();
  });

  it('uses the desk agent when the row has no assignee at all', () => {
    expect(verificationOwnerName({ zohoOwnerName: 'Robert Toms' }, DESK)).toBe(DESK);
    expect(verificationOwnerName({ ownerName: '   ', zohoOwnerName: 'Robert Toms' }, DESK)).toBe(DESK);
  });
});
