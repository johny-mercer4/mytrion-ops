/**
 * Mytrion access logging (POST /v1/audit/mytrion-access) — the security trail for "which internal
 * user opened which Mytrion, and when".
 *
 * Fire-and-forget by design: a logging blip must never keep someone out of a workspace they can
 * legitimately enter. The server derives WHO from the session and checks the claimed Mytrion
 * against the caller's resolved grant, so this call carries no identity of its own.
 */
import { request } from './transport';

export function logMytrionAccess(mytrion: string): void {
  /**
   * Sent WITH the act-as headers (the default) rather than as the real admin. Under "view as", the
   * row is then attributed to the identity the workspace was actually entered as, with the real
   * admin preserved in `impersonator_user_id` — both facts, instead of one. Stripping the headers
   * here would have recorded the admin alone and lost which agent's view they were looking at.
   */
  void request('POST', '/audit/mytrion-access', {
    body: { mytrion },
  }).catch(() => undefined);
}
