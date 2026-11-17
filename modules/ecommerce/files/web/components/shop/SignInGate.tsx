import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Skeleton } from "@repo/ui/components/skeleton";
import { phoneText } from "@web/lib/shop";
import { currentBuyer, signOut } from "@web/lib/shop-auth";
import type { ShopSessionUser } from "@web/lib/shop-auth";
import { PhoneStep } from "./PhoneStep";

// The order pages are session only (plan 0106, "Order page access"): no URL token. A
// signed-out visitor signs in with a code to the phone, on any device, and the page then
// renders what `children` builds for the buyer.

export function SignInGate({
  intro,
  children,
}: {
  intro: string;
  children: (buyer: ShopSessionUser, signedInLine: ReactNode) => ReactNode;
}) {
  const [buyer, setBuyer] = useState<ShopSessionUser | null | "loading">(
    "loading"
  );

  useEffect(() => {
    void currentBuyer().then(setBuyer);
  }, []);

  if (buyer === "loading") {
    return <Skeleton className="h-48 rounded-xl" />;
  }

  if (buyer === null) {
    return (
      <div className="bg-card text-card-foreground max-w-lg rounded-xl border p-5 md:p-6">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Sign in</h2>
        <PhoneStep
          intro={intro}
          signedIn={null}
          verifyLabel="Verify and sign in"
          onVerified={() => {
            setBuyer("loading");
            void currentBuyer().then(setBuyer);
          }}
        />
      </div>
    );
  }

  const who =
    buyer.phoneNumber && buyer.phoneNumberVerified
      ? phoneText(buyer.phoneNumber)
      : buyer.email;
  const signedInLine = (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span>
        Signed in as <span className="text-foreground font-medium">{who}</span>
      </span>
      <span aria-hidden="true">|</span>
      <button
        type="button"
        className="text-foreground underline underline-offset-4"
        onClick={() => {
          void signOut().then(() => {
            window.location.reload();
          });
        }}
      >
        Sign out
      </button>
    </p>
  );
  return <>{children(buyer, signedInLine)}</>;
}
