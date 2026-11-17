import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";

import {
  cartLineNotice,
  productPath,
  ShopClientError,
} from "@repo/ecommerce/client";
import type { ShopCart } from "@repo/ecommerce/client";
import { buttonVariants } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import {
  announceCart,
  money,
  SHOP_BASE,
  shopClient,
  shopPaths,
} from "@web/lib/shop";
import { ErrorLine, QuantityStepper, Thumb, WarningLine } from "./shop-ui";

// The cart page's island. The cart lives on the api: a guest's on the `shop_cart` cookie,
// a signed-in buyer's on the account. A line above the stock or no longer for sale shows
// why, and "Check out" stays off until every line can be bought.

function message(error: unknown): string {
  return error instanceof ShopClientError
    ? error.message
    : "Something went wrong. Try again.";
}

export function CartPage() {
  const [cart, setCart] = useState<ShopCart | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);

  useEffect(() => {
    shopClient()
      .cart()
      .then(setCart)
      .catch((error: unknown) => {
        setLoadError(message(error));
      });
  }, []);

  async function change(variantId: string, quantity: number) {
    setBusyLine(variantId);
    setProblem(null);
    try {
      const next =
        quantity === 0
          ? await shopClient().removeLine(variantId)
          : await shopClient().setQuantity(variantId, quantity);
      setCart(next);
      announceCart(next.itemCount);
      setBusyLine(null);
    } catch (error) {
      setProblem(message(error));
      setBusyLine(null);
    }
  }

  if (loadError) {
    return (
      <div className="bg-card rounded-xl border p-6">
        <ErrorLine message={`The cart did not load. ${loadError}`} />
        <a
          href={shopPaths.cart}
          className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
        >
          Try again
        </a>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
        <Skeleton className="h-60 rounded-xl" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="bg-card rounded-xl border p-8 text-center">
        <p className="text-lg font-medium">Your cart is empty.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Add something from the shop and it shows here.
        </p>
        <a href={shopPaths.catalog} className={cn(buttonVariants(), "mt-5")}>
          Browse the shop
        </a>
      </div>
    );
  }

  const blocked = cart.lines.some((line) => cartLineNotice(line) !== null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-4">
          {cart.lines.map((line) => {
            const notice = cartLineNotice(line);
            const busy = busyLine === line.variantId;
            return (
              <li
                key={line.variantId}
                className="bg-card text-card-foreground grid grid-cols-[5rem_minmax(0,1fr)] gap-4 rounded-xl border p-4 sm:grid-cols-[8rem_minmax(0,1fr)]"
              >
                <Thumb image={line.image} className="aspect-square w-full" />
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <a
                        href={productPath(SHOP_BASE, line.productSlug)}
                        className="font-semibold wrap-anywhere hover:underline hover:underline-offset-4"
                      >
                        {line.productTitle}
                      </a>
                      {line.variantTitle && (
                        <p className="text-muted-foreground text-sm">
                          {line.variantTitle}
                        </p>
                      )}
                      {line.unitPrice !== null && (
                        <p className="text-sm tabular-nums">
                          {money(line.unitPrice, cart.currency)}
                        </p>
                      )}
                    </div>
                    {line.unitPrice !== null && (
                      <p className="font-semibold tabular-nums">
                        {money(line.unitPrice * line.quantity, cart.currency)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <QuantityStepper
                      label={`Quantity of ${line.productTitle}`}
                      value={line.quantity}
                      max={Math.max(line.quantity, line.available)}
                      disabled={busy || !line.forSale}
                      onChange={(next) => {
                        void change(line.variantId, next);
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                      onClick={() => {
                        void change(line.variantId, 0);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {notice && <WarningLine>{notice}</WarningLine>}
                </div>
              </li>
            );
          })}
        </ul>
        <ErrorLine message={problem} />
        <a
          href={shopPaths.catalog}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 self-start text-sm underline underline-offset-4"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Continue shopping
        </a>
      </div>

      <aside className="bg-card text-card-foreground flex flex-col gap-4 self-start rounded-xl border p-5">
        <h2 className="text-xl font-semibold tracking-tight">Order summary</h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">
              {money(cart.subtotal, cart.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Shipping</dt>
            <dd className="text-muted-foreground">chosen at checkout</dd>
          </div>
        </dl>
        <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold">
          <span>Total so far</span>
          <span className="tabular-nums">
            {money(cart.subtotal, cart.currency)}
          </span>
        </div>
        {blocked ? (
          <>
            <span
              aria-disabled="true"
              className={cn(
                buttonVariants({ size: "lg" }),
                "pointer-events-none h-11 w-full text-base opacity-50"
              )}
            >
              Check out
            </span>
            <p className="text-muted-foreground text-sm">
              Fix the lines marked above to check out.
            </p>
          </>
        ) : (
          <a
            href={shopPaths.checkout}
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 w-full text-base"
            )}
          >
            Check out
          </a>
        )}
      </aside>
    </div>
  );
}
