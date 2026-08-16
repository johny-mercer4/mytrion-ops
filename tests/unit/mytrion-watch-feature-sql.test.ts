/**
 * Where Mytrion Watch's figures come from.
 *
 * The scoring maths is tested next door; this guards the SOURCE of what the desk displays, because a
 * wrong number here is indistinguishable from a right one on screen. Identity used to be MAX() over
 * `postlimit_default_list`, an overdue export, which attributed 496 of 728 carriers to the wrong
 * sales agent — 281 of them to nobody at all.
 */
import { describe, expect, it } from 'vitest';
import { WATCH_FEATURE_SQL, WATCH_FEATURE_SQL_ONE } from '../../src/modules/mytrionWatch/featureSql.js';

describe('identity comes from the company dimension', () => {
  it('reads company_name, agent and credit_limit from octane.dim_company', () => {
    expect(WATCH_FEATURE_SQL).toMatch(/FROM octane\.dim_company/);
    expect(WATCH_FEATURE_SQL).toMatch(/co\.company_name/);
    expect(WATCH_FEATURE_SQL).toMatch(/co\.agent_name/);
  });

  it('does NOT take the name or agent from the overdue export any more', () => {
    // The old CTE also filtered on a parseable credit_limit, so a carrier with no numeric limit in
    // that table lost its name and agent entirely.
    expect(WATCH_FEATURE_SQL).not.toMatch(/MAX\(company_name\)/);
    expect(WATCH_FEATURE_SQL).not.toMatch(/MAX\(agent\)/);
  });

  it('still falls back to the overdue list for a limit the dimension lacks', () => {
    // 460 carriers company-wide have an approved limit only there; preferring the dimension must not
    // blank them.
    expect(WATCH_FEATURE_SQL).toMatch(/COALESCE\(NULLIF\(co\.credit_limit, 0\), pl\.credit_limit\)/);
  });
});

describe('the scored population is unchanged', () => {
  /**
   * These filters define WHO gets a score, and the model was trained on this population. They are
   * deliberately still the tag-based definitions even though `octane.dim_company` exposes
   * `payment_terms` and `is_debtor`: measured against those, prepay agrees on 728 of 751 but the
   * debtor definitions agree on only 671 of 1,243. Swapping them would silently re-score hundreds of
   * carriers against a model trained on a different population — a decision for the business, not a
   * refactor.
   */
  it('excludes prepay by tag, not by payment_terms', () => {
    expect(WATCH_FEATURE_SQL).toMatch(/LOWER\(t\.tag_name\) LIKE '%prepay%'/);
    expect(WATCH_FEATURE_SQL).not.toMatch(/payment_terms\s*=\s*'Prepay'/);
  });

  it('excludes debtors by tag, not by is_debtor', () => {
    expect(WATCH_FEATURE_SQL).toMatch(/LIKE '%debtors%'/);
    expect(WATCH_FEATURE_SQL).not.toMatch(/\bis_debtor\b/);
  });
});

describe('the single-carrier variant stays in step', () => {
  it('is the same query with one extra bound parameter', () => {
    expect(WATCH_FEATURE_SQL_ONE.startsWith(WATCH_FEATURE_SQL)).toBe(true);
    expect(WATCH_FEATURE_SQL_ONE).toMatch(/WHERE b\.carrier_id = \$2::bigint/);
  });

  it('has no stray backtick — the SQL lives inside a JS template literal', () => {
    // A backtick in a SQL comment terminates the string and turns the rest of the query into code.
    expect(WATCH_FEATURE_SQL).not.toContain('`');
  });
});
