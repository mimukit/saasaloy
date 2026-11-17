import { useMemo, useState } from "react";
import { TruckIcon } from "lucide-react";

import {
  initialSelection,
  ShopClientError,
  valueState,
  variantFor,
} from "@repo/ecommerce/client";
import type { ShopProduct, ShopSelection } from "@repo/ecommerce/client";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { announceCart, money, shopClient, shopPaths } from "@web/lib/shop";
import { ErrorLine, QuantityStepper, Thumb } from "./shop-ui";

// The product page's island: the gallery, one row of choices per option, the quantity and
// "Add to cart". A choice no variant sells is disabled; a sold-out choice stays pickable
// so the page can say which combination is out, and the button turns into a disabled
// "Out of stock" with that sentence under it.

export interface ProductBuyProps {
  product: ShopProduct;
  /** Whether cash on delivery is on, for the line under the button. */
  cashOnDelivery: boolean;
}

export function ProductBuy({ product, cashOnDelivery }: ProductBuyProps) {
  const [selection, setSelection] = useState<ShopSelection>(() =>
    initialSelection(product)
  );
  const [quantity, setQuantity] = useState(1);
  const [imageId, setImageId] = useState(product.images[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const variant = variantFor(product, selection);
  const available = variant?.available ?? 0;
  const soldOut = variant !== undefined && available <= 0;
  const shownImage = useMemo(
    () =>
      product.images.find((image) => image.id === imageId) ??
      product.images[0] ??
      null,
    [product.images, imageId]
  );
  const price = variant?.price ?? null;

  function choose(optionId: string, valueId: string) {
    const next = { ...selection, [optionId]: valueId };
    setSelection(next);
    setAdded(false);
    setProblem(null);
    const picked = variantFor(product, next);
    setQuantity((value) =>
      Math.max(1, Math.min(value, picked?.available ?? 1))
    );
    const own = picked
      ? product.images.find((image) => image.variantId === picked.id)
      : undefined;
    if (own) {
      setImageId(own.id);
    }
  }

  async function add() {
    if (!variant || busy) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const cart = await shopClient().addToCart(variant.id, quantity);
      announceCart(cart.itemCount);
      setAdded(true);
      setBusy(false);
    } catch (error) {
      setProblem(
        error instanceof ShopClientError
          ? error.message
          : "Something went wrong. Try again."
      );
      setBusy(false);
    }
  }

  const soldOutText = variant ? `${variant.title} is out of stock.` : "";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-8">
      <div className="flex flex-col gap-3">
        <Thumb image={shownImage} className="aspect-[4/3] w-full rounded-xl" />
        {product.images.length > 1 && (
          <div className="grid grid-cols-4 gap-3">
            {product.images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                aria-label={`Show image ${index + 1}`}
                aria-pressed={image.id === shownImage?.id}
                className="focus-visible:ring-ring/50 aria-pressed:ring-foreground rounded-lg outline-none focus-visible:ring-3 aria-pressed:ring-2"
                onClick={() => {
                  setImageId(image.id);
                }}
              >
                <Thumb image={image} className="aspect-square w-full" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card text-card-foreground flex flex-col gap-5 self-start rounded-xl border p-5 md:p-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere">
            {product.title}
          </h1>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {price === null ? "Not for sale" : money(price, product.currency)}
          </p>
        </div>

        {product.options.map((option) => (
          <fieldset key={option.id}>
            <legend className="mb-2 text-sm font-medium">{option.name}</legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const state = valueState(
                  product,
                  selection,
                  option.id,
                  value.id
                );
                const chosen = selection[option.id] === value.id;
                return (
                  <button
                    key={value.id}
                    type="button"
                    aria-pressed={chosen}
                    disabled={state === "missing"}
                    title={
                      state === "missing"
                        ? "Not sold with the other choices"
                        : state === "sold_out"
                          ? "Out of stock"
                          : undefined
                    }
                    className={cn(
                      "focus-visible:ring-ring/50 h-10 min-w-12 rounded-lg border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-40",
                      chosen
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted",
                      state === "sold_out" &&
                        !chosen &&
                        "text-muted-foreground line-through",
                      state === "sold_out" &&
                        chosen &&
                        "bg-muted text-foreground border-foreground line-through"
                    )}
                    onClick={() => {
                      choose(option.id, value.id);
                    }}
                  >
                    {value.value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div>
          <p className="mb-2 text-sm font-medium">Quantity</p>
          <QuantityStepper
            label="Quantity"
            value={quantity}
            max={Math.max(1, available)}
            disabled={soldOut || !variant}
            onChange={setQuantity}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="h-11 w-full text-base"
            disabled={busy || soldOut || !variant || price === null}
            onClick={() => {
              void add();
            }}
          >
            {soldOut ? "Out of stock" : busy ? "Adding…" : "Add to cart"}
          </Button>
          {soldOut && (
            <p className="text-muted-foreground text-sm">
              {soldOutText}
              {product.options.length > 0 ? " Pick another choice." : ""}
            </p>
          )}
          {!variant && (
            <p className="text-muted-foreground text-sm">
              Pick one of each to see the price.
            </p>
          )}
          {added && (
            <p role="status" className="text-sm">
              Added to cart.{" "}
              <a
                href={shopPaths.cart}
                className="font-medium underline underline-offset-4"
              >
                View cart
              </a>
            </p>
          )}
          <ErrorLine message={problem} />
        </div>

        {cashOnDelivery && (
          <p className="text-muted-foreground flex items-center gap-2 border-t pt-4 text-sm">
            <TruckIcon aria-hidden="true" className="size-4 shrink-0" />
            Cash on delivery is available.
          </p>
        )}
      </div>
    </div>
  );
}
