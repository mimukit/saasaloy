import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { auth, forgetSession } from "@app/lib/auth";

/**
 * Sign out, then send the visitor to /sign-in. The shell's account menu calls it.
 *
 * The order matters: the cookie goes first, then the cached session, then the root guard
 * runs again with nothing cached. Skipping `forgetSession()` would let the guard read the
 * old session from memory and keep the shell open.
 *
 * A failed call leaves the visitor signed in and says so. It never pretends the sign-out
 * worked, because the cookie would still open the app on the next load.
 */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await auth.signOut();
      forgetSession();
      await router.invalidate();
      await router.navigate({ to: "/sign-in" });
    } catch {
      setError(
        "Could not reach the api, so you are still signed in. Try again."
      );
    }

    // Not a `finally` block: the React Compiler cannot lower one.
    setPending(false);
  }

  return { pending, error, signOut };
}
