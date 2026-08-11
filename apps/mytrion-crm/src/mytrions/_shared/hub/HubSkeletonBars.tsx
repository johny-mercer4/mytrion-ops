/**
 * The two placeholder primitives shared by every hub skeleton.
 *
 * `Bar` renders `.mg-sk`, the single shimmer in the hub chrome (hubWorkspace.css) — shape it at the
 * call site, never restyle it. `Block` stands in for a whole card: it keeps the card's footprint, not
 * its innards, and rounds at --mg-r-md so the placeholder grid has the same silhouette as the grid
 * that replaces it.
 *
 * Extracted to _shared/hub when Referrals and Loyalty moved to Marketing — Manager kept the task
 * skeletons, Marketing took the referral and loyalty ones, and both need these two.
 *
 * Skeletons are `aria-hidden`; the surrounding region carries `role="status"` + `aria-busy` and the
 * human-readable label, because a shimmer says nothing to a screen reader.
 */
/** One placeholder bar. `w`/`h` are any CSS length. `line` drops the border for text-shaped bars. */
export function Bar({
  w = '100%',
  h = '12px',
  line = true,
  delay = 0,
  style,
}: {
  w?: string;
  h?: string;
  line?: boolean;
  delay?: 0 | 1 | 2;
  style?: React.CSSProperties;
}) {
  const cls = ['mg-sk', line ? 'mg-sk-line' : '', delay ? `mg-sk-d${delay}` : '']
    .filter(Boolean)
    .join(' ');
  return <span className={cls} style={{ width: w, height: h, ...style }} />;
}

/**
 * A block placeholder standing in for a whole card — keeps the card's footprint, not its innards.
 * Rounds at --mg-r-md, the radius every card in the module uses, so the placeholder grid has the
 * same silhouette as the grid that replaces it.
 */
export function Block({ h, delay = 0 }: { h: string; delay?: 0 | 1 | 2 }) {
  return <Bar w="100%" h={h} line={false} delay={delay} style={{ borderRadius: 'var(--mg-r-md)' }} />;
}
