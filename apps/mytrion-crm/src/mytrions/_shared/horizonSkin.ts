import type { MytrionId } from '../../access/mytrions.config';

/**
 * Mytrions rendered with the Horizon glass skin — translucent chrome, the Horizon gradient as the
 * accent ramp, and the picker's hover language (lift + glow ring + specular hairline) carried into
 * the module surfaces. Styling keys off `[data-horizon='on']` on the shell root; see
 * `styles/horizon.css` for the tokens, `MytrionShell.module.css` + `TopBar.module.css` for the frame.
 *
 * ADD AN ID HERE to opt a module in. Everything else keeps the flat token chrome, so the rollout is
 * one Mytrion at a time rather than a single all-or-nothing switch.
 */
const HORIZON_SKIN: ReadonlySet<MytrionId> = new Set<MytrionId>(['admin', 'manager', 'recruit']);

/** `'on'` for skinned modules, `undefined` otherwise — so the attribute is simply absent. */
export function horizonSkin(id: MytrionId): 'on' | undefined {
  return HORIZON_SKIN.has(id) ? 'on' : undefined;
}
