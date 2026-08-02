import { incrementCounter } from './metrics.js';

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export interface RequestAdmissionLease {
  deadlineAt: number;
  release(): void;
}

export interface RequestAdmissionSnapshot {
  pending: number;
  users: number;
  carriers: number;
  maxPending: number;
  maxPendingPerUser: number;
  maxPendingPerCarrier: number;
  maxQueueWaitMs: number;
}

export class RequestAdmissionController {
  private pending = 0;
  private readonly pendingByUser = new Map<string, number>();
  private readonly pendingByCarrier = new Map<string, number>();

  constructor(
    private readonly maxPending: number,
    private readonly maxPendingPerUser: number,
    private readonly maxPendingPerCarrier: number,
    private readonly maxQueueWaitMs: number,
  ) {}

  tryAdmit(
    userKey: string,
    carrierId: string,
    receivedAt = Date.now(),
  ): RequestAdmissionLease | null {
    const userPending = this.pendingByUser.get(userKey) ?? 0;
    const carrierPending = this.pendingByCarrier.get(carrierId) ?? 0;
    if (
      this.pending >= this.maxPending ||
      userPending >= this.maxPendingPerUser ||
      carrierPending >= this.maxPendingPerCarrier
    ) {
      incrementCounter('request_admission_rejected_total');
      return null;
    }

    this.pending += 1;
    this.pendingByUser.set(userKey, userPending + 1);
    this.pendingByCarrier.set(carrierId, carrierPending + 1);
    let released = false;
    return {
      deadlineAt: receivedAt + this.maxQueueWaitMs,
      release: () => {
        if (released) return;
        released = true;
        this.pending = Math.max(0, this.pending - 1);
        const remaining = Math.max(0, (this.pendingByUser.get(userKey) ?? 1) - 1);
        if (remaining) this.pendingByUser.set(userKey, remaining);
        else this.pendingByUser.delete(userKey);
        const carrierRemaining = Math.max(
          0,
          (this.pendingByCarrier.get(carrierId) ?? 1) - 1,
        );
        if (carrierRemaining) this.pendingByCarrier.set(carrierId, carrierRemaining);
        else this.pendingByCarrier.delete(carrierId);
      },
    };
  }

  snapshot(): RequestAdmissionSnapshot {
    return {
      pending: this.pending,
      users: this.pendingByUser.size,
      carriers: this.pendingByCarrier.size,
      maxPending: this.maxPending,
      maxPendingPerUser: this.maxPendingPerUser,
      maxPendingPerCarrier: this.maxPendingPerCarrier,
      maxQueueWaitMs: this.maxQueueWaitMs,
    };
  }
}

const requestAdmission = new RequestAdmissionController(
  positiveInt('MAX_PENDING_REQUESTS', 200),
  positiveInt('MAX_PENDING_PER_USER', 3),
  positiveInt('MAX_PENDING_PER_CARRIER', 10),
  positiveInt('MAX_REQUEST_QUEUE_WAIT_MS', 45_000),
);

export function tryAdmitRequest(
  userKey: string,
  carrierId: string,
  receivedAt?: number,
): RequestAdmissionLease | null {
  return requestAdmission.tryAdmit(userKey, carrierId, receivedAt);
}

export function requestAdmissionSnapshot(): RequestAdmissionSnapshot {
  return requestAdmission.snapshot();
}
