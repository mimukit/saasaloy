import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { users, verifications } from "../schema/auth";
import { smsMessages } from "../schema/sms-messages";
import {
  liveTriesLeft,
  loginCodeIdentifier,
  loginCodePurposeOf,
  loginCodeState,
} from "./login-code-rules";
import type {
  LoginCodePurpose,
  LoginCodeRules,
  LoginCodeState,
} from "./login-code-rules";

// The login codes of the last 30 minutes, behind the admin login codes screen. Each row
// is one `login_code` SMS, so one code request. The code itself sits in `verifications`,
// where Better Auth's `phoneNumber()` plugin keeps it. This file reads that row for the
// state and the tries left, never writes it, and never answers the code.

/** How far back the list reads. */
export const LOGIN_CODE_WINDOW_MINUTES = 30;

/** The most SMS rows the list reads. The send limits keep a real window far below it. */
const LOGIN_CODE_ROW_LIMIT = 500;

/** The `sms_messages.purpose` `sendLoginCode()` in `packages/auth/src/phone.ts` logs. */
const LOGIN_CODE_PURPOSE = "login_code";

export interface LoginCodeRow {
  /** The `sms_messages` row id. */
  id: string;
  phone: string;
  purpose: LoginCodePurpose;
  sentAt: Date;
  /** Whether the SMS went out. A failed send still leaves a code the plugin stored. */
  sendStatus: "sent" | "failed";
  /** The provider's error text, as logged. The api masks codes in it before it answers. */
  error: string | null;
  /** The account that owns the phone today, or `null` for a sign-up code. */
  account: { id: string; name: string; email: string } | null;
  state: LoginCodeState;
  /** Tries left on a live code. `null` for any other state. */
  triesLeft: number | null;
}

/** The newest `verifications` row for each identifier, by the plugin's own order. */
async function newestVerifications(
  db: Db,
  identifiers: readonly string[]
): Promise<Map<string, { value: string; expiresAt: Date }>> {
  const newest = new Map<string, { value: string; expiresAt: Date }>();
  if (identifiers.length === 0) {
    return newest;
  }
  const rows = await db
    .select({
      expiresAt: verifications.expiresAt,
      identifier: verifications.identifier,
      value: verifications.value,
    })
    .from(verifications)
    .where(inArray(verifications.identifier, [...identifiers]))
    .orderBy(desc(verifications.createdAt), desc(verifications.id));
  for (const row of rows) {
    if (!newest.has(row.identifier)) {
      newest.set(row.identifier, row);
    }
  }
  return newest;
}

/** The `login_code` SMS rows of the last 30 minutes, newest first, with their state. */
export async function listLoginCodes(
  db: Db,
  rules: LoginCodeRules,
  now: Date = new Date()
): Promise<LoginCodeRow[]> {
  const since = new Date(now.getTime() - LOGIN_CODE_WINDOW_MINUTES * 60 * 1000);
  const rows = await db
    .select({
      account: { email: users.email, id: users.id, name: users.name },
      sms: smsMessages,
    })
    .from(smsMessages)
    // The account is the one that owns the phone today. A sign-up code has none yet.
    .leftJoin(users, eq(users.phoneNumber, smsMessages.toPhone))
    .where(
      and(
        eq(smsMessages.purpose, LOGIN_CODE_PURPOSE),
        gte(smsMessages.createdAt, since)
      )
    )
    .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
    .limit(LOGIN_CODE_ROW_LIMIT);

  // Rows run newest first, so the first row seen for an identifier is its newest request,
  // the only one whose code the plugin still checks.
  const newestRequest = new Map<string, string>();
  const requests = rows.map((row) => {
    const purpose = loginCodePurposeOf(row.sms.template);
    const identifier = loginCodeIdentifier(row.sms.toPhone, purpose);
    if (!newestRequest.has(identifier)) {
      newestRequest.set(identifier, row.sms.id);
    }
    return { ...row, identifier, purpose };
  });
  const stored = await newestVerifications(db, [...newestRequest.keys()]);

  return requests.map(({ account, sms, purpose, identifier }) => {
    const code = stored.get(identifier);
    const triesLeft =
      newestRequest.get(identifier) === sms.id && code !== undefined
        ? liveTriesLeft(code, rules, now)
        : null;
    return {
      // A left join answers a row of nulls for a phone with no account.
      account: account?.id ? account : null,
      error: sms.error,
      id: sms.id,
      phone: sms.toPhone,
      purpose,
      sendStatus: sms.status,
      sentAt: sms.createdAt,
      state: loginCodeState(sms.createdAt, triesLeft, rules, now),
      triesLeft,
    };
  });
}
