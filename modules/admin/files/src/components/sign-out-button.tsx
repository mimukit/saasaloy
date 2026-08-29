import { useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@repo/ui/components/button";

import { auth, forgetSession } from "@admin/lib/auth";

// Sign-out is the one control both shells need: the admin sidebar has it, and so does the
// access-denied panel a signed-in non-admin lands on. It lives in its own file so those two
// share the order of operations rather than each re-deriving it.
//
// That order matters. The server clears the httpOnly cookie, then the cached session is
// dropped, and only then does the router re-run the root guard. Invalidating first would
// re-run `beforeLoad` against the stale cache and put the user straight back where they were.
export function SignOutButton({
  variant = "ghost",
}: {
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setPending(true);
    setError(null);
    try {
      await auth.signOut();
      forgetSession();
      await router.invalidate();
      await router.navigate({ to: "/login" });
    } catch {
      // `signOut()` rejects rather than resolving with an error when the request never
      // reaches the api. Say so: the session is still live, and a silent no-op on a
      // sign-out button reads like the click was lost.
      setError("Could not reach the api, so you are still signed in. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        size="sm"
        className="w-full justify-start"
        disabled={pending}
        onClick={handleSignOut}
      >
        <LogOutIcon data-icon="inline-start" />
        {pending ? "Signing out…" : "Sign out"}
      </Button>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
