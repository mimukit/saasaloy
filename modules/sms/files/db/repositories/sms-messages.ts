import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { smsMessages } from "../schema/sms-messages";
import type { SmsStatus } from "../schema/sms-messages";
import type { Db } from "../client";

// The SMS log's queries, written once for both dialects. `@repo/sms` sends and never
// writes here: a caller that wants a send on the record calls `logSms()` after
// `createSms(env).send()`, success or failure. That keeps `packages/sms` free of any
// database dependency.

export interface SmsLogEntry {
  /** The account the text went to. Null for a number with no account yet. */
  userId?: string | null;
  /** Free text the caller names, such as `sign_up`. A send limit counts by it. */
  purpose: string;
  /** E.164. */
  toPhone: string;
  template: string;
  /** The provider's `name`, which is the `SMS_PROVIDER` value. */
  provider: string;
  providerRef?: string | null;
  status: SmsStatus;
  /** The error text on a failed send. Never the body. */
  error?: string | null;
}

/** Write one row for one send. */
export async function logSms(db: Db, entry: SmsLogEntry): Promise<void> {
  await db.insert(smsMessages).values(entry);
}

export interface SmsCountQuery {
  toPhone: string;
  /** One purpose, or several that share one budget. */
  purpose: string | readonly string[];
  since: Date;
}

/**
 * How many texts went to `toPhone` for `purpose` at or after `since`. A failed send
 * counts too, so a provider outage does not turn into unlimited retries.
 */
export async function countSmsSince(
  db: Db,
  { toPhone, purpose, since }: SmsCountQuery
): Promise<number> {
  const purposes = typeof purpose === "string" ? [purpose] : [...purpose];
  const [row] = await db
    .select({ sent: count() })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.toPhone, toPhone),
        inArray(smsMessages.purpose, purposes),
        gte(smsMessages.createdAt, since)
      )
    );
  return row?.sent ?? 0;
}

/** Rows per page of the admin log. */
export const SMS_LOG_PAGE_SIZE = 50;

export interface SmsLogPageQuery {
  /** 1-based. */
  page: number;
  status?: SmsStatus;
}

/** One page of the log, newest first, with the total the filter matches. */
export async function listSmsMessages(
  db: Db,
  { page, status }: SmsLogPageQuery
) {
  const where =
    status === undefined ? undefined : eq(smsMessages.status, status);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(smsMessages)
      .where(where)
      .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
      .limit(SMS_LOG_PAGE_SIZE)
      .offset((page - 1) * SMS_LOG_PAGE_SIZE),
    db.select({ total: count() }).from(smsMessages).where(where),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}
