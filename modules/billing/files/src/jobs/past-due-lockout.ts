import { billingConfig } from "../config";
import { notifyBilling } from "../notify";
import { inBillingStore, requireBillingStore } from "../store";
import { invalidateEntitlements } from "../subscription";
import type { BillingStore } from "../subscription";
import type { RegisteredJob } from "./event";

// The dunning end-stop: the daily sweep that finally takes the paid plan away.
//
// `past_due` deliberately keeps the plan (see `LIVE_STATUSES` in ../provider.ts), because
// the first failed charge is usually an expired card and cutting a paying customer off that
// same hour is the wrong trade. `BILLING_LOCKOUT_DAYS` is how long that grace runs. This job
// sweeps once a day, sets `lockedAt` on everything past the window, and sends the account
// -locked email; `currentSubscription` then stops returning the row and entitlements fall
// back to the default plan. A later `payment.succeeded` clears the lock (../subscription.ts).
//
// It is a scheduled job rather than a check inside the entitlement read for two reasons. A
// read that mutated would write from a GET, and the email — the part the subject actually
// notices — would only go out if they happened to open the app.
//
// A schedule, not a `setInterval`: the tick comes from the platform through
// `dueSchedules(at)` in `packages/queue`, so the sweep survives an isolate going away and a
// deploy, and gets the same retries and dead-lettering as any other message.

/** The job's name, as the schedule below and the `jobs` table both spell it. */
export const BILLING_PAST_DUE_LOCKOUT_JOB = "billing.past-due-lockout";

/**
 * The schedule's own name, distinct from the job's. `defineSchedule` requires both, and a
 * project reads this one in a `dueSchedules` trace.
 */
export const BILLING_PAST_DUE_LOCKOUT_SCHEDULE =
  "billing.past-due-lockout.daily";

/**
 * 03:00 UTC daily. Off the hour a vendor retries a failed charge on, so the sweep sees a
 * row the vendor has already had its own last go at, and outside the hours a project's own
 * traffic peaks in.
 */
export const BILLING_PAST_DUE_LOCKOUT_CRON = "0 3 * * *";

/**
 * The slice of `@repo/queue`'s `Schedule` this file implements, declared here rather than
 * imported — the same arrangement, and for the same reason, as `RegisteredJob` in
 * `./event.ts`: `packages/queue` imports this package to register the job, so importing it
 * back would put a cycle in the workspace graph.
 *
 * One consequence worth knowing: the cron above is not parsed at module load the way a
 * `defineSchedule` call would parse it. `dueSchedules` parses it on every tick instead, so a
 * malformed expression throws on the first tick rather than on the first import. The
 * constant is a literal in this file and never comes from config, so there is nothing for a
 * project to get wrong.
 */
export interface RegisteredSchedule {
  readonly name: string;
  readonly cron: string;
  readonly job: string;
  readonly payload: unknown;
}

/** What one sweep did, for the caller's log and for the tests. */
export interface LockoutResult {
  /** Rows the sweep locked. */
  locked: number;
  /** Rows it locked and could send the account-locked email for. */
  notified: number;
}

/**
 * Lock every `past_due` row whose window has run out, and tell each subject.
 *
 * `now` is a parameter rather than a `new Date()` inside, so a test can drive the clock
 * across the boundary instead of sleeping through it.
 */
export async function runPastDueLockout(
  db: BillingStore,
  now: Date,
  lockoutDays: number
): Promise<LockoutResult> {
  const before = new Date(now.getTime() - lockoutDays * 24 * 60 * 60 * 1000);
  const rows = await db.pastDueSince(before);
  const result: LockoutResult = { locked: 0, notified: 0 };

  for (const row of rows) {
    // Written one row at a time rather than as one bulk `update`, because each row also
    // owes an email and a bulk write would leave the sweep unable to say which rows it
    // actually changed. The set is small by construction: it is the rows that failed a
    // charge more than `lockoutDays` ago and have not paid since.
    await db.patchSubscription(row.id, { lockedAt: now });
    result.locked += 1;

    const subject = {
      customerType: row.customerType,
      referenceId: row.referenceId,
    };
    invalidateEntitlements(subject);

    // A subject with no resolvable address is a skip, not a throw: the lock is the part
    // that matters and it is already written, and failing here would re-run the whole
    // sweep and re-send every other subject's email on the retry.
    const to = await db.recipientFor(subject);
    if (to?.email) {
      await notifyBilling({
        kind: "account.locked",
        subject,
        subscription: { ...row, lockedAt: now },
        to,
      });
      result.notified += 1;
    }
  }

  return result;
}

/**
 * The job, as the `jobs` table registers it. A factory returning a job, not a bare
 * constant, for the reason `./event.ts` records: the table registers a *call*, which is what
 * the `plugin-array` patch appends and `saasaloy remove` takes back out.
 */
export const pastDueLockoutJob = (): RegisteredJob => ({
  durable: false,
  name: BILLING_PAST_DUE_LOCKOUT_JOB,
  parse: (payload: unknown) => Promise.resolve(payload),
  // The sweep only ever runs from the platform's cron tick, so there is never a request
  // scope around it. `inBillingStore` is what opens one; see `../store.ts`.
  run: async () => {
    await inBillingStore(async () => {
      await runPastDueLockout(
        requireBillingStore(),
        new Date(),
        billingConfig().lockoutDays
      );
    });
  },
});

/** The daily tick, as the `schedules` table registers it. */
export const pastDueLockoutSchedule = (): RegisteredSchedule => ({
  cron: BILLING_PAST_DUE_LOCKOUT_CRON,
  job: BILLING_PAST_DUE_LOCKOUT_JOB,
  name: BILLING_PAST_DUE_LOCKOUT_SCHEDULE,
  payload: {},
});
