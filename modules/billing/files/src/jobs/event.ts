import { handleBillingEvent, BILLING_EVENT_JOB } from "./event-handler";
import type { BillingEventPayload } from "./event-handler";

// The one background job the capability ships, and its registration wrapper.
//
// A provider's webhook verifies the vendor's signature, maps the vendor event onto a
// normalized `BillingEvent` and enqueues it here. `billing-console` enqueues the same
// shape from `createCheckout`, which is how the local provider runs the whole flow with no
// network. The body lives in `./event-handler.ts`; this file is the shape the `jobs` table
// registers.
//
// A factory returning a job, not a bare constant, because the table in
// `packages/queue/src/index.ts` registers a *call* — `billingEventJob()` — and that is the
// shape the `plugin-array` patch appends and `saasaloy remove` takes back out.

/**
 * The slice of `@repo/queue`'s `Job` this file implements, declared here rather than
 * imported.
 *
 * `packages/billing` has zero runtime dependencies and `packages/queue/src/index.ts`
 * imports *this* package to register the job, so importing `@repo/queue` back would put a
 * cycle in the workspace graph for one interface. The shape is structural: register a job
 * that stops matching and the scaffolded project's `jobs: [billingEventJob()]` line fails
 * `pnpm typecheck`, which is where a drift should surface.
 */
export interface RegisteredJob {
  readonly name: string;
  readonly durable: boolean;
  parse(payload: unknown): Promise<unknown>;
  run(payload: unknown, ctx: unknown): Promise<void>;
}

export const billingEventJob = (): RegisteredJob => ({
  durable: false,
  name: BILLING_EVENT_JOB,
  // No Standard Schema. The payload is minted by a provider inside this same package, not
  // by a caller, so the shape is a code path rather than an input to validate — and a
  // schema would be the core's first npm dependency.
  parse: (payload: unknown) => Promise.resolve(payload),
  run: async (payload: unknown) => {
    await handleBillingEvent(payload as BillingEventPayload);
  },
});
