import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ShoppingBagIcon } from "lucide-react";

import { config } from "@repo/config";
import {
  addressLines,
  cartLineNotice,
  orderPath,
  ShopClientError,
} from "@repo/ecommerce/client";
import type {
  ShopAddressInput,
  ShopCart,
  ShopMethod,
  ShopSavedAddress,
  ShopZone,
} from "@repo/ecommerce/client";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import {
  announceCart,
  methodHint,
  money,
  phoneText,
  SHOP_BASE,
  shopClient,
  shopPaths,
} from "@web/lib/shop";
import {
  currentBuyer,
  signOut,
  toPhone,
  verifiedContact,
} from "@web/lib/shop-auth";
import type { ShopSessionUser } from "@web/lib/shop-auth";
import { PhoneStep } from "./PhoneStep";
import { ErrorLine, FieldLabel, Thumb, WarningLine } from "./shop-ui";

// The checkout island (plan 0106, Phase 6). Three steps, in order: Contact, Delivery,
// Payment. A finished step folds into one row that says what it settled, so the screen
// always shows one open step. Contact folds into "Verified +880…" once the phone is
// verified: that row is the shop's signature, the proof the order goes to a real number.
//
// Contact is skipped for a buyer already signed in with a verified phone, and for one on
// a verified email unless `requirePhoneOtp` is set (plan 0106, "Checkout identity").
// Every figure comes from the api; the page shows the zone rate only to add it up.

type Contact =
  { kind: "phone"; phone: string } | { kind: "email"; email: string };

interface Delivery {
  addressId?: string;
  address?: ShopAddressInput;
  saveAddress: boolean;
  zone: ShopZone;
  /** The address as one line, for the folded row. */
  summary: string;
}

interface Loaded {
  buyer: ShopSessionUser | null;
  cart: ShopCart;
  zones: ShopZone[];
  methods: ShopMethod[];
}

function message(error: unknown): string {
  return error instanceof ShopClientError
    ? error.message
    : "Something went wrong. Try again.";
}

function oneLine(address: ShopAddressInput): string {
  return [address.name, ...addressLines(address)].join(", ");
}

const { requirePhoneOtp } = config.ecommerce;

/** Everything checkout shows before the first step: who is signed in, the cart, the choices. */
async function fetchCheckout(): Promise<Loaded> {
  const client = shopClient();
  const [buyer, cart, zones, methods] = await Promise.all([
    currentBuyer(),
    client.cart(),
    client.zones(),
    client.paymentMethods(),
  ]);
  return { buyer, cart, methods, zones };
}

export function Checkout() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [typedName, setTypedName] = useState("");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [editingDelivery, setEditingDelivery] = useState(false);

  useEffect(() => {
    fetchCheckout()
      .then((found) => {
        setLoaded(found);
        setContact(verifiedContact(found.buyer, requirePhoneOtp));
        announceCart(found.cart.itemCount);
      })
      .catch((error: unknown) => {
        setLoadError(message(error));
      });
  }, []);

  /** Load again after sign-in: the cart merges, the identity changes. */
  function reload() {
    setLoaded(null);
    fetchCheckout()
      .then((found) => {
        setLoaded(found);
        setContact(verifiedContact(found.buyer, requirePhoneOtp));
        announceCart(found.cart.itemCount);
      })
      .catch((error: unknown) => {
        setLoadError(message(error));
      });
  }

  if (loadError) {
    return (
      <div className="bg-card rounded-xl border p-6">
        <ErrorLine message={`Checkout did not load. ${loadError}`} />
        <a
          href={shopPaths.checkout}
          className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
        >
          Try again
        </a>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    );
  }

  const { cart, zones, methods, buyer } = loaded;

  if (cart.lines.length === 0) {
    return (
      <div className="bg-card rounded-xl border p-8 text-center">
        <p className="text-lg font-medium">Your cart is empty.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Add something from the shop, then check out here.
        </p>
        <a href={shopPaths.catalog} className={cn(buttonVariants(), "mt-5")}>
          Browse the shop
        </a>
      </div>
    );
  }

  const blocked = cart.lines.some((line) => cartLineNotice(line) !== null);
  const deliveryOpen =
    contact !== null && (delivery === null || editingDelivery);
  const paymentOpen = contact !== null && delivery !== null && !editingDelivery;
  const shipping = delivery?.zone.rate ?? null;
  const total = cart.subtotal + (shipping ?? 0);

  const summary = (
    <OrderSummary cart={cart} shipping={shipping} total={total} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <details className="bg-card group rounded-xl border lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
          <ShoppingBagIcon aria-hidden="true" className="size-5" />
          <span className="flex-1">
            Order summary{" "}
            <span className="tabular-nums">{money(total, cart.currency)}</span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="border-t p-4">{summary}</div>
      </details>

      <div className="flex min-w-0 flex-col gap-4">
        {blocked && (
          <div className="bg-card rounded-xl border p-4">
            <WarningLine>
              A line in your cart cannot be bought as it is.{" "}
              <a
                href={shopPaths.cart}
                className="font-medium underline underline-offset-4"
              >
                Fix it in the cart
              </a>
            </WarningLine>
          </div>
        )}

        {contact ? (
          <ContactRow
            contact={contact}
            onSignedOut={() => {
              window.location.reload();
            }}
          />
        ) : (
          <StepCard number={1} title="Contact">
            <PhoneStep
              askName
              signedIn={buyer}
              intro="We send a code by SMS to check the number. Your order updates go to it."
              onVerified={({ name }) => {
                setTypedName(name);
                reload();
              }}
            />
          </StepCard>
        )}

        {deliveryOpen ? (
          <StepCard
            number={2}
            title="Delivery"
            subtitle="Choose a delivery address and shipping zone"
          >
            <DeliveryForm
              zones={zones}
              contactPhone={contact.kind === "phone" ? contact.phone : ""}
              defaultName={typedName || buyer?.name || ""}
              currency={cart.currency}
              initial={delivery}
              onDone={(next) => {
                setDelivery(next);
                setEditingDelivery(false);
              }}
            />
          </StepCard>
        ) : delivery && contact ? (
          <FoldedRow
            number={2}
            title="Delivery"
            onChange={() => {
              setEditingDelivery(true);
            }}
          >
            <span className="block wrap-anywhere">{delivery.summary}</span>
            <span className="text-muted-foreground block">
              {delivery.zone.name}{" "}
              {money(delivery.zone.rate, delivery.zone.currency)}
            </span>
          </FoldedRow>
        ) : (
          <WaitingRow
            number={2}
            title="Delivery"
            waitsOn="Verify your phone to continue"
          />
        )}

        {paymentOpen && delivery ? (
          <StepCard number={3} title="Payment">
            <PaymentForm
              methods={methods}
              delivery={delivery}
              total={total}
              currency={cart.currency}
              blocked={blocked}
              onPhoneLost={() => {
                setContact(null);
              }}
            />
          </StepCard>
        ) : (
          <WaitingRow
            number={3}
            title="Payment"
            waitsOn={
              contact
                ? "Choose the delivery to continue"
                : "Verify your phone to continue"
            }
          />
        )}
      </div>

      <aside className="bg-card text-card-foreground hidden self-start rounded-xl border p-5 lg:block">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">
          Order summary
        </h2>
        {summary}
      </aside>
    </div>
  );
}

function StepNumber({
  number,
  done = false,
  muted = false,
}: {
  number: number;
  done?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        muted
          ? "bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground"
      )}
    >
      {done ? <CheckIcon className="size-4" /> : number}
    </span>
  );
}

function StepCard({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`step-${number}`}
      className="bg-card text-card-foreground rounded-xl border p-5 md:p-6"
    >
      <div className="mb-5 flex items-start gap-3">
        <StepNumber number={number} />
        <div>
          <h2
            id={`step-${number}`}
            className="text-xl font-semibold tracking-tight"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function FoldedRow({
  number,
  title,
  onChange,
  children,
}: {
  number: number;
  title: string;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${title}, done`}
      className="bg-card text-card-foreground flex items-start gap-3 rounded-xl border px-5 py-4"
    >
      <StepNumber number={number} done />
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <h2 className="shrink-0 font-semibold sm:border-r sm:pr-4">{title}</h2>
        <div className="min-w-0 flex-1 text-sm">{children}</div>
      </div>
      <button
        type="button"
        className="shrink-0 text-sm underline underline-offset-4"
        aria-label={`Change ${title.toLowerCase()}`}
        onClick={onChange}
      >
        Change
      </button>
    </section>
  );
}

function WaitingRow({
  number,
  title,
  waitsOn,
}: {
  number: number;
  title: string;
  waitsOn: string;
}) {
  return (
    <section
      aria-label={`${title}, not yet`}
      className="bg-card text-muted-foreground flex items-center gap-3 rounded-xl border px-5 py-4"
    >
      <StepNumber number={number} muted />
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm">{waitsOn}</p>
      </div>
    </section>
  );
}

/** The signature: Contact folded into the number it verified, with a way to switch. */
function ContactRow({
  contact,
  onSignedOut,
}: {
  contact: Contact;
  onSignedOut: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const shown =
    contact.kind === "phone" ? phoneText(contact.phone) : contact.email;
  return (
    <FoldedRow
      number={1}
      title="Contact"
      onChange={() => {
        setAsking(true);
      }}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="wrap-anywhere">
          {contact.kind === "phone" ? "Verified " : "Signed in as "}
          {shown}
        </span>
      </span>
      {asking && (
        <span className="mt-3 flex flex-col gap-2">
          <span className="text-muted-foreground">
            To use another number, sign out first. Your cart stays saved on{" "}
            {shown}.
          </span>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void signOut().then(onSignedOut);
              }}
            >
              Sign out
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep {contact.kind === "phone" ? "this number" : "this account"}
            </Button>
          </span>
        </span>
      )}
    </FoldedRow>
  );
}

function OrderSummary({
  cart,
  shipping,
  total,
}: {
  cart: ShopCart;
  shipping: number | null;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y">
        {cart.lines.map((line) => (
          <li
            key={line.variantId}
            className="flex items-center gap-3 py-3 first:pt-0"
          >
            <Thumb image={line.image} className="size-16" />
            <div className="min-w-0 flex-1">
              <p className="font-medium wrap-anywhere">{line.productTitle}</p>
              {line.variantTitle && (
                <p className="text-muted-foreground text-sm">
                  {line.variantTitle}
                </p>
              )}
            </div>
            <p className="shrink-0 text-sm tabular-nums">
              {line.quantity} ×{" "}
              {line.unitPrice === null
                ? ""
                : money(line.unitPrice, cart.currency)}
            </p>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">
            {money(cart.subtotal, cart.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Shipping</dt>
          <dd
            className={cn(
              "tabular-nums",
              shipping === null && "text-muted-foreground"
            )}
          >
            {shipping === null
              ? "chosen with the delivery"
              : money(shipping, cart.currency)}
          </dd>
        </div>
      </dl>
      <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{money(total, cart.currency)}</span>
      </div>
    </div>
  );
}

const NEW_ADDRESS = "new";

function DeliveryForm({
  zones,
  contactPhone,
  defaultName,
  currency,
  initial,
  onDone,
}: {
  zones: ShopZone[];
  contactPhone: string;
  defaultName: string;
  currency: string;
  initial: Delivery | null;
  onDone: (delivery: Delivery) => void;
}) {
  const ids = useId();
  const [saved, setSaved] = useState<ShopSavedAddress[] | null>(null);
  const [choice, setChoice] = useState<string>(
    initial?.addressId ?? NEW_ADDRESS
  );
  const [form, setForm] = useState({
    area: initial?.address?.area ?? "",
    city: initial?.address?.city ?? "",
    line1: initial?.address?.line1 ?? "",
    name: initial?.address?.name ?? defaultName,
    phone:
      initial?.address?.phone ?? (contactPhone ? phoneText(contactPhone) : ""),
  });
  const [save, setSave] = useState(initial?.saveAddress ?? true);
  const [zoneId, setZoneId] = useState(initial?.zone.id ?? zones[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  // `initial` and `zones` only seed the first choice; both stay put while the form is open.
  useEffect(() => {
    shopClient()
      .addresses()
      .then((rows) => {
        setSaved(rows);
        if (!initial && rows[0]) {
          setChoice(rows[0].id);
          if (
            rows[0].zoneId &&
            zones.some((zone) => zone.id === rows[0]?.zoneId)
          ) {
            setZoneId(rows[0].zoneId);
          }
        }
      })
      .catch(() => {
        // No saved addresses to offer; the new-address form still works.
        setSaved([]);
      });
  }, [initial, zones]);

  function field(
    key: keyof typeof form,
    label: string,
    extra: {
      autoComplete: string;
      type?: string;
      optional?: boolean;
    }
  ) {
    const id = `${ids}-${key}`;
    return (
      <div>
        <FieldLabel htmlFor={id}>
          {label}
          {extra.optional && (
            <span className="text-muted-foreground font-normal">
              {" "}
              (optional)
            </span>
          )}
        </FieldLabel>
        <Input
          id={id}
          type={extra.type ?? "text"}
          autoComplete={extra.autoComplete}
          className="h-10"
          value={form[key]}
          onChange={(event) => {
            setForm((current) => ({ ...current, [key]: event.target.value }));
          }}
        />
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const zone = zones.find((row) => row.id === zoneId);
    if (!zone) {
      setProblem("Choose a shipping zone.");
      return;
    }
    if (choice !== NEW_ADDRESS) {
      const address = saved?.find((row) => row.id === choice);
      if (!address) {
        setProblem("Choose an address.");
        return;
      }
      onDone({
        addressId: address.id,
        saveAddress: false,
        summary: oneLine(address),
        zone,
      });
      return;
    }
    const missing = [
      form.name.trim() === "" && "your name",
      form.phone.trim() === "" && "a phone number",
      form.line1.trim() === "" && "the address line",
      form.city.trim() === "" && "the city or district",
    ].filter(Boolean);
    if (missing.length > 0) {
      setProblem(`Enter ${missing.join(", ")}.`);
      return;
    }
    const address: ShopAddressInput = {
      area: form.area.trim() || null,
      city: form.city.trim(),
      line1: form.line1.trim(),
      name: form.name.trim(),
      phone: toPhone(form.phone) ?? form.phone.trim(),
    };
    onDone({ address, saveAddress: save, summary: oneLine(address), zone });
  }

  if (saved === null) {
    return <Skeleton className="h-48 rounded-xl" />;
  }

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
      {saved.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Saved address</legend>
          {saved.map((address) => (
            <ChoiceCard
              key={address.id}
              name={`${ids}-address`}
              value={address.id}
              checked={choice === address.id}
              onSelect={setChoice}
            >
              <span className="block font-medium">{address.name}</span>
              <span className="text-muted-foreground block text-sm">
                {addressLines(address).join(", ")}
              </span>
            </ChoiceCard>
          ))}
          <ChoiceCard
            name={`${ids}-address`}
            value={NEW_ADDRESS}
            checked={choice === NEW_ADDRESS}
            onSelect={setChoice}
          >
            <span className="font-medium">Add a new address</span>
          </ChoiceCard>
        </fieldset>
      )}

      {choice === NEW_ADDRESS && (
        <div className="flex flex-col gap-4">
          {saved.length > 0 && (
            <h3 className="text-sm font-medium">New address details</h3>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("name", "Name", { autoComplete: "name" })}
            {field("phone", "Phone", { autoComplete: "tel", type: "tel" })}
          </div>
          {field("line1", "Address line", { autoComplete: "address-line1" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("area", "Area", {
              autoComplete: "address-level3",
              optional: true,
            })}
            {field("city", "City or district", {
              autoComplete: "address-level2",
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={save}
              onChange={(event) => {
                setSave(event.target.checked);
              }}
            />
            Save this address for next time
          </label>
        </div>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Shipping zone</legend>
        {zones.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The shop has no shipping zone yet, so it cannot take orders. Try
            again later.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {zones.map((zone) => (
              <ChoiceCard
                key={zone.id}
                name={`${ids}-zone`}
                value={zone.id}
                checked={zoneId === zone.id}
                onSelect={setZoneId}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{zone.name}</span>
                  <span className="tabular-nums">
                    {money(zone.rate, zone.currency || currency)}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        )}
      </fieldset>

      <ErrorLine message={problem} />
      <div>
        <Button
          type="submit"
          size="lg"
          className="h-10 px-5"
          disabled={zones.length === 0}
        >
          Continue to payment
        </Button>
      </div>
    </form>
  );
}

/** A radio drawn as a bordered row; the whole row is the label. */
function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "has-focus-visible:ring-ring/50 flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors has-focus-visible:ring-3",
        checked ? "border-foreground bg-muted/50" : "hover:bg-muted/50"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        className="accent-primary mt-1 size-4 shrink-0"
        onChange={() => {
          onSelect(value);
        }}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function PaymentForm({
  methods,
  delivery,
  total,
  currency,
  blocked,
  onPhoneLost,
}: {
  methods: ShopMethod[];
  delivery: Delivery;
  total: number;
  currency: string;
  blocked: boolean;
  onPhoneLost: () => void;
}) {
  const ids = useId();
  // Cash on delivery first: most buyers in the shop's market pay that way.
  const ordered = methods.toSorted(
    (a, b) => Number(b.id === "cod") - Number(a.id === "cod")
  );
  const [method, setMethod] = useState(ordered[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function place(event: FormEvent) {
    event.preventDefault();
    if (busy || !method) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // No `returnUrl`: `payment` checks it against PAYMENT_APP_URL even for a manual
      // method, so a hosted checkout returns to its provider's default address.
      const placed = await shopClient().checkout({
        address: delivery.address,
        addressId: delivery.addressId,
        paymentMethod: method,
        saveAddress: delivery.saveAddress,
        zoneId: delivery.zone.id,
      });
      announceCart(0);
      if (placed.next.kind === "redirect") {
        window.location.assign(placed.next.url);
        return;
      }
      window.location.assign(orderPath(SHOP_BASE, placed.order.number));
    } catch (error) {
      if (
        error instanceof ShopClientError &&
        error.code === "phone_unverified"
      ) {
        onPhoneLost();
      }
      setProblem(message(error));
      setBusy(false);
    }
  }

  if (methods.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        The shop takes no payment method yet, so it cannot take orders. Try
        again later.
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={place}>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Payment method</legend>
        {ordered.map((row) => (
          <ChoiceCard
            key={row.id}
            name={`${ids}-method`}
            value={row.id}
            checked={method === row.id}
            onSelect={setMethod}
          >
            <span className="block font-medium">{row.label}</span>
            {method === row.id && (
              <span className="text-muted-foreground block text-sm">
                {methodHint(row.id)}
              </span>
            )}
          </ChoiceCard>
        ))}
      </fieldset>
      <ErrorLine message={problem} />
      {problem && (
        <a
          href={shopPaths.cart}
          className="self-start text-sm underline underline-offset-4"
        >
          Back to the cart
        </a>
      )}
      <Button
        type="submit"
        size="lg"
        className="h-11 w-full text-base"
        disabled={busy || blocked}
      >
        {busy ? "Placing order…" : `Place order ${money(total, currency)}`}
      </Button>
      {blocked && (
        <p className="text-muted-foreground text-sm">
          Fix the cart first: a line cannot be bought as it is.
        </p>
      )}
    </form>
  );
}
