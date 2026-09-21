import { manualRenewalProviders } from "../define";
import { notifyBilling } from "../notify";
import { inBillingStore, requireBillingStore } from "../store";
import { invalidateEntitlements } from "../subscription";
import type { BillingStore } from "../subscription";
import type { RegisteredJob } from "./event";
import type { RegisteredSchedule } from "./past-due-lockout";

// The daily sweep that starts dunning for a provider whose vendor will never start it.
//
// A card vendor charges the stored instrument when a period ends, and the row only leaves
// `active` if that charge fails. A gateway that stores nothing — SSLCOMMERZ is the first —
// has no schedule of its own and no instrument to charge, so a period simply runs out. This
// job is what notices: it moves the row to `past_due` and asks the subject to pay for the
// next period through `POST /billing/renew`.
//
// `past_due` still entitles the paid plan (see `LIVE_STATUSES`), so nothing is taken away
// here. `billing.past-due-lockout` is what finally takes it, `BILLING_LOCKOUT_DAYS` later,
// and it reads the same `updatedAt` this job's write refreshes. The two jobs are a sequence
// and this one is the front of it.
//
// It only ever touches rows whose `provider` column names a provider that declared
// `renewal: "manual"`. A project running Stripe alone gets an empty provider set, so the
// sweep runs and selects nothing; a project that switched providers leaves its old rows to
// the old provider's rules.

/** The job's name, as the schedule below and the `jobs` table both spell it. */
export const BILLING_RENEWAL_DUE_JOB = "billing.renewal-due";

/** The schedule's own name, distinct from the job's. `defineSchedule` requires both. */
export const BILLING_RENEWAL_DUE_SCHEDULE = "billing.renewal-due.daily";

/**
 * 02:00 UTC daily, an hour ahead of the lockout sweep at 03:00. A row that runs out
 * overnight is therefore `past_due` before the lockout job first looks at it, and its
 * grace window starts on the day the period actually ended rather than a day later.
 */
export const BILLING_RENEWAL_DUE_CRON = "0 2 * * *";

/** What one sweep did, for the caller's log and for the tests. */
export interface RenewalDueResult {
  /** Rows the sweep moved to `past_due`. */
  due: number;
  /** Rows it moved and could send the renewal-due email for. */
  notified: number;
}

/**
 * Mark every manually renewed row whose period has ended, and ask each subject to pay.
 *
 * `now` and `providers` are parameters rather than reads inside, so a test drives the clock
 * across a period boundary and names its own provider instead of registering one.
 */
export async function runRenewalDue(
  db: BillingStore,
  now: Date,
  providers: string[]
): Promise<RenewalDueResult> {
  const result: RenewalDueResult = { due: 0, notified: 0 };

  if (providers.length === 0) {
    // Nothing installed renews manually. The query would select nothing anyway; skipping it
    // keeps a Stripe-only project from paying for a table scan every morning.
    return result;
  }

  const rows = await db.renewalDue(now, providers);

  for (const row of rows) {
    // One row at a time, like the lockout sweep and for the same reason: each row also owes
    // an email, and a bulk update would leave the sweep unable to say which rows it changed.
    await db.patchSubscription(row.id, { status: "past_due" });
    result.due += 1;

    const subject = {
      customerType: row.customerType,
      referenceId: row.referenceId,
    };
    invalidateEntitlements(subject);

    // `reminderSentAt` is the same row-level guard the trial reminder uses. A row that is
    // already carrying one has been told — by the trial reminder, or by an earlier run that
    // the query re-selected — and a second email adds nothing.
    if (row.reminderSentAt) {
      continue;
    }

    // A subject with no resolvable address is a skip, not a throw. The status write is the
    // part that matters and it has already happened, and failing here would re-run the whole
    // sweep and re-send every other subject's email on the retry.
    const to = await db.recipientFor(subject);
    if (!to?.email) {
      continue;
    }

    await notifyBilling({
      kind: "renewal.due",
      subject,
      // `updatedAt` is moved forward to match the write above. The template counts the
      // lockout date off it, and the row the sweep read still carries the old value, so
      // passing it through would name a date earlier than the one the lockout job acts on.
      subscription: { ...row, status: "past_due", updatedAt: now },
      to,
    });
    await db.patchSubscription(row.id, { reminderSentAt: now });
    result.notified += 1;
  }

  return result;
}

/**
 * The job, as the `jobs` table registers it. A factory returning a job, not a bare
 * constant, for the reason `./event.ts` records: the table registers a *call*, which is what
 * the `plugin-array` patch appends and `saasaloy remove` takes back out.
 */
export const renewalDueJob = (): RegisteredJob => ({
  durable: false,
  name: BILLING_RENEWAL_DUE_JOB,
  parse: (payload: unknown) => Promise.resolve(payload),
  // The sweep only ever runs from the platform's cron tick, so there is never a request
  // scope around it. `inBillingStore` is what opens one; see `../store.ts`.
  run: async () => {
    await inBillingStore(async () => {
      await runRenewalDue(
        requireBillingStore(),
        new Date(),
        manualRenewalProviders()
      );
    });
  },
});

/** The daily tick, as the `schedules` table registers it. */
export const renewalDueSchedule = (): RegisteredSchedule => ({
  cron: BILLING_RENEWAL_DUE_CRON,
  job: BILLING_RENEWAL_DUE_JOB,
  name: BILLING_RENEWAL_DUE_SCHEDULE,
  payload: {},
});
