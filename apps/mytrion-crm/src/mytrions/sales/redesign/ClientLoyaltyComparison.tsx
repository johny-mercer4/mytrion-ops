import { s } from './dc';
import { numFmt } from './live';

export interface ClientLoyaltyComparisonProps {
  previousInNetworkGallons: number;
  currentInNetworkGallons: number;
  previousTotalGallons: number;
  currentTotalGallons: number;
  previousCards: number;
  currentCards: number;
  accountActiveCards: number;
  owed: number;
}

/** Closed-month tier inputs beside the live month-to-date projection. */
export function ClientLoyaltyComparison(props: ClientLoyaltyComparisonProps) {
  const periods = [
    {
      label: 'Last month · tier basis',
      gallons: props.previousInNetworkGallons,
      total: props.previousTotalGallons,
      cards: props.previousCards,
    },
    {
      label: 'This month · progress',
      gallons: props.currentInNetworkGallons,
      total: props.currentTotalGallons,
      cards: props.currentCards,
    },
  ];
  return (
    <>
      <div
        style={s(
          'display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)',
        )}
      >
        {periods.map((period) => (
          <section
            key={period.label}
            style={s(
              'padding:11px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)',
            )}
          >
            <div
              style={s(
                'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)',
              )}
            >
              {period.label}
            </div>
            <div
              style={s(
                "margin-top:5px;font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:var(--text)",
              )}
            >
              {numFmt(Math.round(period.gallons))}
              <span style={s('font-size:11px;color:var(--muted)')}> gal</span>
            </div>
            <div
              style={s(
                'display:flex;justify-content:space-between;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid var(--border2);font-size:11px;color:var(--muted)',
              )}
            >
              <span>{period.cards} transacting cards</span>
              <span>{numFmt(Math.round(period.total))} total gal</span>
            </div>
          </section>
        ))}
      </div>
      <div
        style={s(
          'display:flex;align-items:center;gap:14px;margin-top:10px;font-size:11.5px;color:var(--muted)',
        )}
      >
        <span>
          <strong
            style={s("font-family:'JetBrains Mono',monospace;color:var(--text)")}
          >
            {props.accountActiveCards}
          </strong>{' '}
          account active cards
        </span>
        {props.owed >= 1 ? (
          <span style={s('margin-left:auto;color:var(--danger)')}>
            <strong>{`$${Math.round(props.owed).toLocaleString('en-US')}`}</strong> owed
          </span>
        ) : null}
      </div>
    </>
  );
}
