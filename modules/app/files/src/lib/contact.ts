// A customer who signs up by phone gets a placeholder email, `<digits>@phone.invalid`,
// because Better Auth needs an email on every account. The app never shows that
// placeholder as an address, so a screen names the account by its phone instead.
//
// Pure, and it imports nothing: `app` can be installed without `auth-phone`, so the
// `.invalid` rule lives here and not in an import from it. `admin` holds the same rule in
// its own `src/lib/contact.ts`.

const PHONE_PLACEHOLDER = /^(\d+)@phone\.invalid$/;

/** The email when it is real, or `+<digits>` when the account signed up by phone. */
export function contactOf(email: string): string {
  const match = PHONE_PLACEHOLDER.exec(email);
  return match?.[1] === undefined ? email : `+${match[1]}`;
}
