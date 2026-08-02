import { registerCommsThreadAuthorizer } from '../realtime/hub.js';
import { commsThreadRepo } from '../../repos/commsThreadRepo.js';

/**
 * Wire the comms module into the realtime hub.
 *
 * The dependency direction is comms → realtime, never the reverse: the hub imports only `logger` and
 * types, which is what keeps it unit-testable with a fake socket. So the hub exposes a registration
 * hook and this closes over the repo.
 *
 * The authorizer routes to `commsThreadRepo.canReadThread`, i.e. the SAME reader filter the REST path
 * uses. That is the point — a socket subscription and an API read cannot drift apart into two
 * different answers about who may see a thread.
 */
export function registerCommsRealtime(): void {
  registerCommsThreadAuthorizer(async (ctx, threadId) =>
    commsThreadRepo.canReadThread(ctx, threadId),
  );
}
