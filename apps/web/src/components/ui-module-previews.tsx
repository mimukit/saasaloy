// The module blocks the Saasaloy UI preview frame renders (/ui/preview/<name>, plan 0121,
// Phase 5). A module block takes an `onSubmit` function, and Astro serializes island
// props, so a function cannot cross from the .astro page into the island. Each preview here
// closes over a stub `onSubmit` instead, the same way a Saasaloy app closes over its real
// one. Each stub resolves to success, so a submit shows the block's pending and done
// states and sends nothing anywhere.
//
// The blocks resolve to their module sources through the aliases in astro.config.mjs.

import { SignInCard } from "@repo/ui/blocks/auth/sign-in";
import { SignUpCard } from "@repo/ui/blocks/auth/sign-up";
import { Waitlist } from "@repo/ui/blocks/waitlist";

/** Success after a short wait, so the button shows its pending state. */
function settle<T>(value: T): Promise<T> {
  // oxlint-disable-next-line promise/avoid-new -- a browser timer has no promise form
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, 600);
  });
}

export function SignInPreview() {
  return (
    <SignInCard onSubmit={() => settle(undefined)} signUpHref="#sign-up" />
  );
}

export function SignUpPreview() {
  return (
    <SignUpCard onSubmit={() => settle(undefined)} signInHref="#sign-in" />
  );
}

export function WaitlistPreview() {
  return <Waitlist onSubmit={() => settle({ ok: true } as const)} />;
}
