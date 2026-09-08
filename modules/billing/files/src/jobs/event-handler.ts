import { BillingError } from "../provider";
import type {
  BillableSubject,
  BillingEvent,
  BillingEventType,
  SubscriptionInput,
} from "../provider";
import { requireBillingStore } from "../store";
import { applyEvent } from "../subscription";
import type { ApplyEventResult } from "../subscription";

// What the `billing.event` job actually does, split out from `./event.ts` so it imports
// nothing but siblings. `./event.ts` is the registration wrapper; this file is the body,
// and the repo's own `node --test` run can import it without a bundler.

/** The job's name, as `enqueue` and the `jobs` table both spell it. */
export const BILLING_EVENT_JOB = "billing.event";

/** A `Date` as it survives a queue message: JSON has none, so it arrives as a string. */
type WireDate = string | Date | null | undefined;

interface WireSubscription extends Omit<
  SubscriptionInput,
  "cancelAt" | "canceledAt" | "endedAt" | "trialEnd" | "trialStart"
> {
  cancelAt?: WireDate;
  canceledAt?: WireDate;
  endedAt?: WireDate;
  trialEnd?: WireDate;
  trialStart?: WireDate;
}

/**
 * What a queue message carries. A message is JSON, so every `Date` in a `BillingEvent`
 * arrives as an ISO string; `reviveEvent` turns them back. Declaring the wire shape
 * separately keeps that conversion in one place instead of scattering `new Date(...)`
 * through the handler.
 */
export interface BillingEventPayload {
  provider: string;
  providerEventId: string;
  type: string;
  occurredAt: WireDate;
  subject: BillableSubject;
  subscription?: WireSubscription;
}

/**
 * Apply one delivered event to the projection.
 *
 * Idempotence is not solved twice here. `applyEvent` inserts `(provider,
 * providerEventId)` into `billing_event` first and returns early on the primary-key
 * conflict, so a redelivered message runs no side effect a second time — which
 * at-least-once delivery makes mandatory rather than optional.
 */
export async function handleBillingEvent(
  payload: BillingEventPayload
): Promise<ApplyEventResult> {
  const store = requireBillingStore();

  try {
    return await applyEvent(store, reviveEvent(payload));
  } catch (error) {
    // A checkout race: a webhook can beat the row the vendor's own synchronous handler is
    // still writing. That is the one failure worth another delivery, so it is re-thrown
    // retryable and everything else keeps whatever the thrower decided.
    if (error instanceof BillingError && error.code === "not_found") {
      throw new BillingError("not_found", error.message, {
        cause: error,
        retryable: true,
        ...(error.providerCode === undefined
          ? {}
          : { providerCode: error.providerCode }),
      });
    }
    throw error;
  }
}

/** Turn a JSON-round-tripped payload back into a `BillingEvent`. */
export function reviveEvent(payload: BillingEventPayload): BillingEvent {
  const subscription = payload.subscription;

  return {
    occurredAt: date(payload.occurredAt) ?? new Date(),
    provider: payload.provider,
    providerEventId: payload.providerEventId,
    subject: payload.subject,
    type: payload.type as BillingEventType,
    ...(subscription === undefined
      ? {}
      : {
          subscription: {
            ...subscription,
            cancelAt: date(subscription.cancelAt) ?? null,
            canceledAt: date(subscription.canceledAt) ?? null,
            endedAt: date(subscription.endedAt) ?? null,
            trialEnd: date(subscription.trialEnd) ?? null,
            trialStart: date(subscription.trialStart) ?? null,
          },
        }),
  };
}

function date(value: WireDate): Date | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
}
