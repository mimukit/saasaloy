import { useEffect, useRef, useState } from "react";
import { MenuIcon, ShoppingCartIcon, XIcon } from "lucide-react";

import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { CART_EVENT, shopClient, shopPaths } from "@web/lib/shop";

// The shop's header: the site name, Shop and Orders, the theme toggle and the cart with
// its count. It follows the base Navbar block's shape (a sticky header that takes no
// space, the bar floating in `nav-float`), with the shop's own links, because the Navbar
// takes no cart. Pages under it give their first section the same top padding.
//
// The count comes from `GET /shop/cart` on load, then from the `shop:cart` event the
// cart, product and checkout islands send after each change.

export interface ShopNavProps {
  siteName: string;
  /** Which link is the current page, for `aria-current`. */
  current?: "shop" | "orders" | "cart";
}

export function ShopNav({ siteName, current }: ShopNavProps) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    shopClient()
      .cart()
      .then((cart) => {
        if (live) {
          setCount(cart.itemCount);
        }
      })
      .catch(() => {
        // No count is better than a wrong one; the cart page says what failed.
      });
    function onCart(event: Event) {
      setCount((event as CustomEvent<number>).detail);
    }
    window.addEventListener(CART_EVENT, onCart);
    return () => {
      live = false;
      window.removeEventListener(CART_EVENT, onCart);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (open && event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const links = [
    { href: shopPaths.catalog, key: "shop", label: "Shop" },
    { href: shopPaths.orders, key: "orders", label: "Orders" },
  ] as const;
  const cartLabel =
    count === null || count === 0
      ? "Cart"
      : `Cart, ${count} ${count === 1 ? "item" : "items"}`;

  return (
    <header className="sticky top-0 z-50 h-0">
      <div className="pointer-events-none px-2 pt-3 lg:px-4 lg:pt-4">
        <div className="nav-float max-w-wide border-border bg-background pointer-events-auto mx-auto rounded-2xl border">
          <div className="flex h-14 items-center gap-2 px-4 sm:gap-4">
            <a
              href="/"
              className="focus-visible:ring-ring/50 truncate rounded-sm font-semibold tracking-tight outline-none focus-visible:ring-3"
            >
              {siteName}
            </a>
            <nav
              aria-label="Shop"
              className="ml-2 hidden items-center gap-6 sm:flex"
            >
              {links.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  aria-current={current === link.key ? "page" : undefined}
                  className="text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground text-sm transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle className="size-10" />
              <a
                href={shopPaths.cart}
                aria-label={cartLabel}
                aria-current={current === "cart" ? "page" : undefined}
                className={cn(
                  buttonVariants({ size: "icon", variant: "ghost" }),
                  "relative size-10"
                )}
              >
                <ShoppingCartIcon aria-hidden="true" />
                {count !== null && count > 0 && (
                  <span
                    aria-hidden="true"
                    className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-4xl px-1 text-xs font-medium tabular-nums"
                  >
                    {count}
                  </span>
                )}
              </a>
              <Button
                ref={toggleRef}
                variant="ghost"
                size="icon"
                className="size-10 sm:hidden"
                aria-controls={open ? "shop-nav-menu" : undefined}
                aria-expanded={open}
                aria-label={open ? "Close menu" : "Open menu"}
                onClick={() => {
                  setOpen((value) => !value);
                }}
              >
                {open ? <XIcon /> : <MenuIcon />}
              </Button>
            </div>
          </div>
          {open && (
            <nav
              id="shop-nav-menu"
              aria-label="Shop"
              className="flex flex-col gap-1 border-t p-3 sm:hidden"
            >
              {links.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  aria-current={current === link.key ? "page" : undefined}
                  className="hover:bg-muted rounded-lg px-2 py-2.5 text-sm"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
