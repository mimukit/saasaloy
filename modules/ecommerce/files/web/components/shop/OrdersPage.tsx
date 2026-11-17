import { useEffect, useState } from "react";

import { itemsText, orderPath, ShopClientError } from "@repo/ecommerce/client";
import type { ShopOrderList } from "@repo/ecommerce/client";
import { buttonVariants } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import {
  money,
  SHOP_BASE,
  shopClient,
  shopPaths,
  shownDate,
} from "@web/lib/shop";
import { SignInGate } from "./SignInGate";
import { ErrorLine, StatusPill } from "./shop-ui";

// The signed-in buyer's orders, newest first: a table from the small-tablet width up,
// one card per order on a phone.

function OrderList() {
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ShopOrderList | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    shopClient()
      .orders(page)
      .then(setList)
      .catch((error: unknown) => {
        setProblem(
          error instanceof ShopClientError
            ? error.message
            : "Something went wrong. Try again."
        );
      });
  }, [page]);

  if (problem) {
    return <ErrorLine message={`Your orders did not load. ${problem}`} />;
  }
  // A page turn keeps the old list until the new one arrives, then shows a skeleton.
  if (!list || list.page !== page) {
    return <Skeleton className="h-64 rounded-xl" />;
  }
  if (list.orders.length === 0) {
    return (
      <div className="bg-card rounded-xl border p-8 text-center">
        <p className="text-lg font-medium">No orders yet.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Orders you place on this number show here.
        </p>
        <a href={shopPaths.catalog} className={cn(buttonVariants(), "mt-5")}>
          Browse the shop
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card hidden overflow-hidden rounded-xl border sm:block">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">
                Order
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Items
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Total
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-5 py-3">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.orders.map((order) => (
              <tr key={order.number}>
                <td className="px-5 py-4 font-medium">{order.label}</td>
                <td className="px-5 py-4">{shownDate(order.createdAt)}</td>
                <td className="px-5 py-4">{itemsText(order.itemCount ?? 0)}</td>
                <td className="px-5 py-4 tabular-nums">
                  {money(order.total, order.currency)}
                </td>
                <td className="px-5 py-4">
                  <StatusPill status={order.status} />
                </td>
                <td className="px-5 py-4 text-right">
                  <a
                    href={orderPath(SHOP_BASE, order.number)}
                    className="underline underline-offset-4"
                    aria-label={`View order ${order.label}`}
                  >
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-4 sm:hidden">
        {list.orders.map((order) => (
          <li key={order.number} className="bg-card rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{order.label}</p>
                <p className="text-muted-foreground text-sm">
                  {shownDate(order.createdAt)}
                </p>
              </div>
              <StatusPill status={order.status} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-sm">
              <span>{itemsText(order.itemCount ?? 0)}</span>
              <span className="tabular-nums">
                {money(order.total, order.currency)}
              </span>
              <a
                href={orderPath(SHOP_BASE, order.number)}
                className="underline underline-offset-4"
                aria-label={`View order ${order.label}`}
              >
                View
              </a>
            </div>
          </li>
        ))}
      </ul>

      {list.pageCount > 1 && (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-4"
        >
          <span className="text-muted-foreground text-sm">
            Page {list.page} of {list.pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonVariants({ variant: "outline" })}
              disabled={page <= 1}
              onClick={() => {
                setPage((value) => value - 1);
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className={buttonVariants({ variant: "outline" })}
              disabled={page >= list.pageCount}
              onClick={() => {
                setPage((value) => value + 1);
              }}
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

export function OrdersPage() {
  return (
    <SignInGate intro="Sign in with the phone number you ordered with. We send a code by SMS.">
      {(_buyer, signedInLine) => (
        <div className="flex flex-col gap-8">
          <div className="-mt-4">{signedInLine}</div>
          <OrderList />
        </div>
      )}
    </SignInGate>
  );
}
