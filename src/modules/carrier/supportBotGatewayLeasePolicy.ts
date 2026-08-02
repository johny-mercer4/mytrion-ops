export interface GatewayLeasePolicyInput {
  holderId: string;
  fencingToken: number;
  expiresAt: Date;
}

export interface GatewayLeaseDecision {
  acquired: boolean;
  changedHolder: boolean;
  fencingToken: number;
}

/** Pure fencing decision used inside the repository's advisory-locked transaction. */
export function decideGatewayLease(
  current: GatewayLeasePolicyInput | undefined,
  requestedHolderId: string,
  now: Date,
): GatewayLeaseDecision {
  if (
    current &&
    current.holderId !== requestedHolderId &&
    current.expiresAt.getTime() > now.getTime()
  ) {
    return {
      acquired: false,
      changedHolder: false,
      fencingToken: current.fencingToken,
    };
  }
  const changedHolder = !current || current.holderId !== requestedHolderId;
  return {
    acquired: true,
    changedHolder,
    fencingToken: current ? current.fencingToken + (changedHolder ? 1 : 0) : 1,
  };
}
