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

  async function handleSignOut() {
    setPending(true);
    try {
      await auth.signOut();
      forgetSession();
      await router.invalidate();
      await router.navigate({ to: "/login" });
    } finally {
      setPending(false);
    }
  }

  return (
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
  );
}
