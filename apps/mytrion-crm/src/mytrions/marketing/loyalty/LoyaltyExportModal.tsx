/**
 * Marketing → Loyalty Program → Export.
 *
 * WHY A DIALOG AND NOT A MONTH PICKER IN THE PAGE HEADER. The board is, by definition, "the tier in
 * force right now". Dropping a month control next to it would read as filtering the board, and the
 * two are different questions — the board's June column means "last month", the export's means
 * "whatever earned the month you picked". Putting the month inside the export makes the pair explicit
 * and unambiguous: the dialog states, in words, which month earns the tier and which month's activity
 * is reported, before anything is downloaded.
 *
 * WHY IT PREVIEWS BEFORE IT WRITES. The file is the whole company book. Downloading first and reading
 * afterwards means opening a 3,000-row workbook to discover the month was wrong, or that a scope
 * dropped the rows you wanted. The preview is the same scored population the file will contain — the
 * same `buildExportPayload`, not a second estimate — so the row count in the footer is the row count
 * in the sheet.
 *
 * Loading: ONE affordance per region. The preview panel skeletons on a cold month; a month already
 * fetched stays on screen and the panel is marked stale while it revalidates, rather than blanking
 * back to a skeleton (CLAUDE.md's double-loader rule).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Fuel,
  MoveRight,
  RefreshCw,
  Trophy,
  X,
} from 'lucide-react';
import { getLoyaltyMonthRoster } from '../../../api/loyalty';
import { useCachedLoad, formatCachedAt } from '../../_shared/swrCache';
import { Bar } from '../../_shared/hub/HubSkeletonBars';
import {
  EXPORT_COLUMNS,
  SCOPE_HELP,
  SCOPE_LABEL,
  buildExportPayload,
  countByScope,
  scoreMonthClients,
  type LoyaltyExportScope,
} from './loyaltyExportModel';
import { downloadLoyaltyExport, type LoyaltyExportFormat } from './loyaltyExportFile';
import { TIER_SWATCH } from './loyaltyExportStyle';
import '../../_shared/hub/hubDialog.css';

const SCOPES: LoyaltyExportScope[] = ['active', 'tiered', 'all'];
/**
 * How far back the picker may reach. Mirrors `LOYALTY_EXPORT_MAX_MONTHS_BACK` in
 * modules/manager/loyaltyMonthRoster.ts, which is the authority — the server refuses anything older
 * with a 400. Restated here so the control never OFFERS a month the request will reject; if the two
 * ever drift the server still wins, and the symptom is a disabled arrow rather than a broken export.
 */
const MAX_MONTHS_BACK = 36;
const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const n0 = (v: number): string => numFmt.format(Math.round(v));

/** `YYYY-MM-01` for the month containing `date`, in UTC — the API's month key. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Shift a `YYYY-MM-01` key by whole months. */
function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(y as number, (m as number) - 1 + months, 1)));
}

function monthName(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The two months, drawn as the relationship they are. This is the requirement, made visible.
 *
 * `inProgress` used to be a full amber callout below this strip. It was removed on request, and the
 * fact moved in here as a quiet qualifier on the month it actually describes — which is a better home
 * for it anyway: the reported month is the thing that is partial, so the caveat belongs on that half
 * of the pair rather than in a separate block repeating both month names. The workbook's Overview
 * sheet still carries the full warning, and that is the copy that matters, because the file outlives
 * this dialog.
 */
function MonthRelation({
  basis,
  month,
  inProgress,
}: {
  basis: string;
  month: string;
  inProgress: boolean;
}) {
  return (
    <div className="mg-lex-relation">
      <span className="mg-lex-relation-part is-basis">
        <Trophy size={14} aria-hidden="true" />
        <small>Tier earned in</small>
        <strong>{basis}</strong>
      </span>
      <MoveRight className="mg-lex-relation-arrow" size={16} aria-hidden="true" />
      <span className="mg-lex-relation-part is-month">
        <Fuel size={14} aria-hidden="true" />
        <small>Activity reported for</small>
        <strong>
          {month}
          {inProgress ? <i>still in progress · partial</i> : null}
        </strong>
      </span>
    </div>
  );
}

export function LoyaltyExportModal({ onClose }: { onClose: () => void }) {
  const currentMonth = useMemo(() => monthKey(new Date()), []);
  const [month, setMonth] = useState(currentMonth);
  const [scope, setScope] = useState<LoyaltyExportScope>('active');
  const [busy, setBusy] = useState<LoyaltyExportFormat | null>(null);
  const [failure, setFailure] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const forceRef = useRef(false);

  const { data, loading, revalidating, error, cachedAt, reload } = useCachedLoad(
    `marketing:loyalty:export:${month}`,
    () => {
      const refresh = forceRef.current;
      forceRef.current = false;
      return getLoyaltyMonthRoster(month, { refresh });
    },
    { staleMs: 300_000 },
  );

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /**
   * The payload is built from the loaded month, NOT re-derived per download. The footer's row count,
   * the preview's distribution and the file's contents are therefore the same object — a preview that
   * can disagree with its own export is worse than no preview.
   */
  const payload = useMemo(
    () => (data && data.month === month ? buildExportPayload(data, scope) : null),
    [data, month, scope],
  );
  /**
   * Per-scope row counts. Deliberately memoised on the MONTH only, not on the scope — scoring is the
   * cheap half of the pipeline and re-running it on every radio click to recount the two scopes that
   * did not change would be work for nothing.
   */
  const scopeCounts = useMemo(
    () => (data && data.month === month ? countByScope(scoreMonthClients(data)) : null),
    [data, month],
  );
  const ready = payload !== null && !loading;

  const download = async (format: LoyaltyExportFormat): Promise<void> => {
    if (!payload) return;
    setBusy(format);
    setFailure('');
    try {
      await downloadLoyaltyExport(payload, format);
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : 'Could not build the export file.');
    } finally {
      setBusy(null);
    }
  };

  const basisName = monthName(shiftMonth(month, -1));
  const earliestMonth = shiftMonth(currentMonth, -MAX_MONTHS_BACK);

  return createPortal(
    <div className="mg-root mg-lty mg-lty-modal-scope" data-mytrion="marketing">
      <div
        className="mg-lty-modal-scrim"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <section
          className="mg-lty-modal mg-lex"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mg-loyalty-export-title"
        >
          <header className="mg-lty-modal-head">
            <span className="mg-lty-modal-icon">
              <FileSpreadsheet size={20} />
            </span>
            <div>
              <span>Loyalty program</span>
              <h2 id="mg-loyalty-export-title">Export tier clients</h2>
              <p>Pick the month to report. Its tier comes from the month before it.</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close export">
              <X size={18} />
            </button>
          </header>

          <div className="mg-lty-modal-body">
            <section className="mg-lty-modal-section">
              <div className="mg-lty-modal-section-head">
                <div>
                  <span>Step 1</span>
                  <h3>Reported month</h3>
                </div>
                <div className="mg-lex-month">
                  <button
                    type="button"
                    className="mg-lex-month-step"
                    onClick={() => setMonth((current) => shiftMonth(current, -1))}
                    disabled={month <= earliestMonth}
                    aria-label={`Previous month, ${monthName(shiftMonth(month, -1))}`}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="mg-lex-month-field" data-focus-shell>
                    <button
                      type="button"
                      onClick={() => {
                        const input = monthInputRef.current;
                        if (!input) return;
                        try {
                          input.showPicker();
                        } catch {
                          input.focus();
                          input.click();
                        }
                      }}
                      aria-label={`Choose the reported month, currently ${monthName(month)}`}
                      aria-haspopup="dialog"
                    >
                      <CalendarDays size={15} aria-hidden="true" />
                      <span className="mg-lex-month-copy">
                        <small>Month</small>
                        <strong>{monthName(month)}</strong>
                      </span>
                    </button>
                    <input
                      ref={monthInputRef}
                      type="month"
                      value={month.slice(0, 7)}
                      // Bounded both ways: the native picker must not offer a month the request
                      // would reject, and typing into it bypasses the arrows entirely.
                      min={earliestMonth.slice(0, 7)}
                      max={currentMonth.slice(0, 7)}
                      onChange={(event) =>
                        setMonth(event.target.value ? `${event.target.value}-01` : currentMonth)
                      }
                      aria-label="Reported month"
                      tabIndex={-1}
                    />
                  </div>
                  <button
                    type="button"
                    className="mg-lex-month-step"
                    onClick={() => setMonth((current) => shiftMonth(current, 1))}
                    disabled={month >= currentMonth}
                    aria-label={`Next month, ${monthName(shiftMonth(month, 1))}`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <MonthRelation
                basis={basisName}
                month={monthName(month)}
                inProgress={month === currentMonth}
              />
            </section>

            <section className="mg-lty-modal-section">
              <div className="mg-lty-modal-section-head">
                <div>
                  <span>Step 2</span>
                  <h3>Which carriers</h3>
                </div>
              </div>
              <div className="mg-lex-scopes" role="group" aria-label="Export scope">
                {SCOPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={scope === option}
                    onClick={() => setScope(option)}
                  >
                    <strong>{SCOPE_LABEL[option]}</strong>
                    <span>{SCOPE_HELP[option]}</span>
                    {/* Every scope's count, not just the selected one — "Tier holders only" being
                        621 against "Every carrier" at 8,215 is the fact that decides the choice. The
                        non-breaking-space fallback holds the line's height before the month lands. */}
                    <em>
                      {scopeCounts ? `${n0(scopeCounts[option])} rows` :' '}
                    </em>
                  </button>
                ))}
              </div>
            </section>

            <section className="mg-lty-modal-section" data-stale={revalidating ? 'true' : undefined}>
              <div className="mg-lty-modal-section-head">
                <div>
                  <span>Step 3</span>
                  <h3>What you will get</h3>
                </div>
                {/* The timestamp is a CAPTION, not the button's label. It used to be the label, so the
                    control read "Updated just now" — a status nobody clicks, whose width changed as it
                    aged. Same split the board header uses.

                    Both are DIRECT children of the section head, deliberately. Wrapping them in a div
                    broke it twice over: `.mg-lty-modal-section-head > button` stopped matching, so the
                    button lost its border, padding and background and wrapped onto two lines; and the
                    caption started matching `.mg-lty-modal-section-head > div > span` — the kicker rule
                    — which uppercased and letter-spaced it. */}
                <span className="mg-lex-cachedat">
                  {revalidating
                    ? 'Measuring…'
                    : cachedAt
                      ? `Updated ${formatCachedAt(cachedAt)}`
                      : ' '}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    forceRef.current = true;
                    reload();
                  }}
                  disabled={loading || revalidating}
                >
                  <RefreshCw size={14} className={revalidating ? 'mg-spin' : ''} />
                  Refresh
                </button>
              </div>

              {/* One loader for this region, and it stands in for the stats AND the distribution —
                  the two used to be able to arrive separately and shove each other down the panel. */}
              {loading || !payload ? (
                <div
                  className="mg-lex-preview-sk"
                  role="status"
                  aria-busy="true"
                  aria-label={`Measuring ${monthName(month)}`}
                >
                  <div aria-hidden="true">
                    {/* TWO, matching the two month tiles it stands in for. It was four, left over from
                        the old four-tile row, so the placeholder wrapped to two rows and the panel
                        shrank by a row's height the moment data landed — a skeleton that does not
                        mirror its own content is a layout shift with extra steps. */}
                    {[0, 1].map((i) => (
                      <Bar key={i} h="52px" line={false} delay={(i % 3) as 0 | 1 | 2} />
                    ))}
                  </div>
                  <div aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <Bar key={i} h="44px" line={false} delay={(i % 3) as 0 | 1 | 2} />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* TWO figures, not four. "Carriers" repeated the selected scope card's own row
                      count AND the footer's, putting the same number on screen three times, and
                      "Hold a tier" repeated the "Tier holders only" card. Cutting both removed a
                      whole tile row — which is also what had been pushing the tier chips under a
                      sliced scroll fold. What is left is the one thing stated nowhere else: the
                      in-network gallons behind each of the two months, labelled to match the
                      relation strip at the top so the pair reads as the same story continued. */}
                  <div className="mg-lex-stats">
                    <div>
                      <span>
                        <Trophy size={14} /> {basisName} · tier basis
                      </span>
                      <strong>
                        {n0(payload.summary.basisInNetworkGallons)} <small>gal</small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Fuel size={14} /> {monthName(month)} · reported
                      </span>
                      <strong>
                        {n0(payload.summary.monthInNetworkGallons)} <small>gal</small>
                      </strong>
                    </div>
                  </div>
                  {/* `role="list"` and not a bare div: an aria-label on a generic container is not
                      announced, so the label was invisible to a screen reader and the six chips
                      arrived as one run of unrelated numbers. */}
                  <div className="mg-lex-dist" role="list" aria-label="Tier distribution in this export">
                    {payload.summary.buckets.map((bucket) => (
                      <span key={bucket.bucket} role="listitem" className="mg-lex-chip">
                        {/* The only non-token colours on this surface, and they are confined to a
                            14px swatch: it previews the actual spreadsheet cell — the export
                            palette's fill as its background, that cell's ink as its ring. Painting
                            the whole chip this way made six paper-light pills the loudest thing in
                            the dark dialog; the chip itself is now theme-native. */}
                        <span
                          className="mg-lex-chip-swatch"
                          style={
                            {
                              '--sw-fill': TIER_SWATCH[bucket.bucket].css,
                              '--sw-ink': TIER_SWATCH[bucket.bucket].inkCss,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        />
                        <strong>{n0(bucket.count)}</strong>
                        {bucket.label}
                        <em>{(bucket.share * 100).toFixed(1)}%</em>
                      </span>
                    ))}
                  </div>
                  <p className="mg-lty-modal-help mg-lex-foot-note">
                    The workbook carries three sheets — an Overview naming both months, the Clients
                    table, and a Legend of the thresholds and perks. Tier, projected tier, perks and
                    exception source arrive as real Excel picklists, each filled with the colour shown
                    in its swatch above. The CSV holds the same {EXPORT_COLUMNS.length} columns as
                    plain text.
                  </p>
                </>
              )}
              {error ? <div className="mg-lty-modal-error">{error}</div> : null}
              {failure ? <div className="mg-lty-modal-error">{failure}</div> : null}
            </section>
          </div>

          <footer className="mg-lty-modal-foot mg-lex-foot">
            <span className="mg-lex-rowcount">
              {payload
                ? `${n0(payload.summary.carriers)} rows · ${EXPORT_COLUMNS.length} columns`
                : 'Measuring the month…'}
            </span>
            <span />
            <button type="button" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            {/* ONE primary, not two. Both buttons were `is-primary`, which put two solid accent
                fills side by side: the eye had nowhere to land and the pair read as a segmented
                control it is not. Excel is the primary because it is the designed artifact — three
                sheets, the coloured tier and perk picklists, the legend. CSV is the same data as
                plain text for a machine, so it takes the tonal tier: obviously available, obviously
                the second choice, still in the primary's colour family. */}
            <button
              type="button"
              className="is-primary"
              onClick={() => void download('xlsx')}
              disabled={!ready || busy !== null}
              title="Styled workbook — coloured tier and perk picklists, overview and legend sheets"
            >
              <FileSpreadsheet size={15} />
              {busy === 'xlsx' ? 'Building…' : 'Excel'}
            </button>
            <button
              type="button"
              className="is-tonal"
              onClick={() => void download('csv')}
              disabled={!ready || busy !== null}
              title="Same columns as plain text, for a spreadsheet import or a script"
            >
              <FileText size={15} />
              {busy === 'csv' ? 'Building…' : 'CSV'}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
