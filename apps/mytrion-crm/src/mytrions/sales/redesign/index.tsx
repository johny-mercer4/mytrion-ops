/**
 * Sales Mytrion — the redesigned bespoke shell (ported from the reference prototype).
 * Self-contained: brings its own theme tokens, fonts, sidebar, top bar, AI copilot, and
 * all tabs, scoped under `.ss-root` so it never affects the rest of the CRM. Replaces the
 * old MytrionShell-based Sales module.
 */
import { SalesRedesign } from './Shell';
import { HomeBootGate } from './homeBoot';

export default function SalesMytrion() {
  return (
    <div data-mytrion="sales" className="contents">
      {/* Suspends the entry loader on the first boot until Home data is preloaded (see homeBoot). */}
      <HomeBootGate />
      <SalesRedesign />
    </div>
  );
}
