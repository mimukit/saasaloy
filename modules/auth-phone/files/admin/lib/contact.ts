// A customer who signs up by phone gets a placeholder email, `<digits>@phone.invalid`,
// because Better Auth needs an email on every account. An admin should never read that
// placeholder as a real address, so a screen names the account by its phone instead.
//
// Pure, and it imports nothing: `admin` can be installed without `auth-phone`, so the
// `.invalid` rule lives here and not in an import from it. `auth-phone` ships this file
// while issue #294 has not landed; #294 then owns it and uses it on the other screens.

const PHONE_PLACEHOLDER = /^(\d+)@phone\.invalid$/;

/** The phone behind a placeholder email, as `+<digits>`, or `null` for a real email. */
export function placeholderPhone(email: string): string | null {
  const match = PHONE_PLACEHOLDER.exec(email);
  return match?.[1] === undefined ? null : `+${match[1]}`;
}

/** The email when it is real, or the phone when the account signed up by phone. */
export function contactOf(email: string): string {
  return placeholderPhone(email) ?? email;
}
