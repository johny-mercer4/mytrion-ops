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

describe('the pay-ratio window waits for invoices to mature', () => {
  /**
   * Invoices fall due on exactly two weekdays — every one of the 247,513 rows in
   * `postlimit_default_list` has an observation_date that is a Monday or a Thursday. Without a lag,
   * the score a carrier gets depends on which weekday you happen to run on: measured over the 724
   * carriers scored on 2026-08-10, this feature contributed 16.75 score points on the Monday anchor
   * and 0.68 on the Tuesday, because Tuesday's window includes Monday's batch at one day old and
   * 452 carriers get charged for an invoice nobody could have paid yet.
   *
   * That is the entire 16-point Mon/Tue gap, and under the daily cron it renders as a weekly
   * sawtooth on the portfolio timeline.
   */
  it('holds the newest batch back by 3 days', () => {
    expect(WATCH_FEATURE_SQL).toMatch(
      /observation_date\s*<\s*\$1::date - INTERVAL '3 days'/,
    );
  });

  it('applies the lag to pay_ratio ONLY', () => {
    // `inv_14` has no payment-maturity term — it averages invoice AMOUNTS, and 14 is already a
    // multiple of 7 — and `hist` is all-history. Lagging them for symmetry would change features
    // that do not move across the weekday split. Every changed line has to trace to the defect.
    const lagged = WATCH_FEATURE_SQL.match(/INTERVAL '3 days'/g) ?? [];
    expect(lagged).toHaveLength(1);
    expect(WATCH_FEATURE_SQL).toMatch(/observation_date\s*>=\s*\$1::date - INTERVAL '14 days'/);
  });

  it('keeps the 31-day lower bound — the fix is batch AGE, not batch COUNT', () => {
    // Snapping the window to 28 days equalises the batch count for every anchor and does NOT fix
    // this: measured, Tuesday still came out at -0.63 points with the same 452 penalised carriers.
    expect(WATCH_FEATURE_SQL).toMatch(/observation_date\s*>=\s*\$1::date - INTERVAL '31 days'/);
  });
});
