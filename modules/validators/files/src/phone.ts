// A Bangladeshi mobile number at the api request boundary, where the input is whatever a
// person typed. It normalizes to canonical E.164, `+8801XXXXXXXXX`.
//
// The other half of this pair lives in `modules/sms-khudebarta/files/khudebarta.ts`, whose
// `BANGLADESH_NUMBER` regex (`/^\+880\d{10}$/`) refuses a recipient the gateway cannot route.
// That check stays dependency-free because `packages/sms` takes no runtime dependency
// (ADR 0020), so the two cannot share a constant. `phone.test.ts` asserts every value this
// schema returns satisfies that regex. Change one and read the other.

import { z } from "zod";

const MESSAGE =
  "must be a Bangladeshi mobile number, for example +8801712345678";

/**
 * Digits, a space, `-`, `(`, `)`, `.` and a leading `+`. This is a rejection boundary, not a
 * strip list: an unlisted character fails the input instead of being discarded, which is what
 * stops `hello01712345678world` from reducing to a valid number.
 */
const ALLOWED = /^\+?[\d\s().-]+$/;

const SEPARATORS = /[\s().-]/g;

/**
 * The five accepted forms, once the separators are gone: `01XXXXXXXXX`, `+8801XXXXXXXXX`,
 * `8801XXXXXXXXX`, `1XXXXXXXXX` and `008801XXXXXXXXX`. The digit after the leading `1` must be
 * `3`-`9`, which rejects `10`, `11` and `12` with no operator table to maintain.
 */
const FORMS = /^(?:\+?880|00880|0)?(1[3-9]\d{8})$/;

/** Canonical E.164 for `raw`, or `null` when it is not a Bangladeshi mobile number. */
function toE164(raw: string): string | null {
  if (!ALLOWED.test(raw)) {
    return null;
  }
  const compact = raw.replace(SEPARATORS, "");
  const match = FORMS.exec(compact);
  return match ? `+880${match[1]}` : null;
}

/** A Bangladeshi mobile number, normalized to `+8801XXXXXXXXX`. ASCII digits only. */
export const bangladeshMobile = z.string().transform((raw, ctx) => {
  const normalized = toE164(raw);
  if (normalized === null) {
    ctx.addIssue({ code: "custom", message: MESSAGE });
    return z.NEVER;
  }
  return normalized;
});
export type BangladeshMobile = z.infer<typeof bangladeshMobile>;
