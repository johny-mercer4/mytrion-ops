import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Finance Mytrion — fueling transactions, client invoicing, balance audits. Ported from mytrion-finance. */
export default function FinanceMytrion() {
  return (
    <MytrionScaffold
      id="finance"
      buildNotes={[
        '7-route + 4-subtab structure → routes.ts (cleanest port; client already framework-agnostic)',
        'octane-client.js fetch layer → shared api transport',
        'Date-preset utilities, flag-emoji + card-masking helpers',
        'Pattern-classification logic for transactions',
      ]}
    />
  );
}
