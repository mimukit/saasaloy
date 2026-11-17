import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { MinusIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";

import { config } from "@repo/config";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import {
  Card,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/shell/card";
import { Checkbox } from "@repo/ui/components/shell/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import { Label } from "@repo/ui/components/shell/label";
import { Radio, RadioGroup } from "@repo/ui/components/shell/radio-group";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { usePageTrail } from "@admin/components/page-trail";
import { api } from "@admin/lib/api";
import { ADMIN_ROLE, SUPERADMIN_ROLE, loadSession } from "@admin/lib/auth";
import {
  ShopRequestError,
  createManualOrder,
  customerQuery,
  lookupCustomer,
  productQuery,
  productsQuery,
  refreshShop,
  zonesQuery,
} from "@admin/lib/shop-api";
import type { LookedUpCustomer, ManualOrderBody } from "@admin/lib/shop-api";
import { SHOP_LOCALE, shownDay } from "@admin/lib/shop-dates";
import {
  COD_METHOD,
  addLine,
  addressLines,
  draftTotals,
  phoneReady,
  setLineQuantity,
} from "@admin/lib/shop-format";
import { money } from "@admin/lib/shop-money";
import type { DraftLine } from "@admin/lib/shop-format";

// The "New order" page at `/shop/orders/new` (Q33 to Q35, round 2 mockup): staff take an
// order by phone. The api runs the checkout transaction: row lock, stock check, the order
// and its holds, then the payment. The order starts `placed`, and its first event names the
// staff member.
//
// The phone decides the buyer (Q34). A number that belongs to a user shows the "Existing
// customer" line with their figures; a new number shows the line that says an account is
// made. Never both: the lookup answers one or the other.
//
// Prices come from the catalog and staff cannot change them (Q35); the summary here is a
// preview, and the api works the real figures out. "Payment already received" takes a
// transaction ID and confirms the payment at once, so it is shown to the admin roles only,
// the roles the payment confirm route takes; the api checks the role again.

export const Route = createFileRoute("/shop/orders/new")({
  component: NewOrder,
});

const CURRENCY = config.ecommerce.currency;

const paymentMethodsQuery = {
  queryKey: ["admin", "shop", "payment-methods"] as const,
  queryFn: async () => {
    const response = await api.shop["payment-methods"].$get();
    if (!response.ok) {
      throw new Error("The payment methods did not load.");
    }
    return (await response.json()) as {
      methods: { id: string; label: string }[];
    };
  },
};

type Lookup =
  | { state: "idle" }
  | { state: "looking" }
  | { state: "known"; customer: LookedUpCustomer }
  | { state: "new" }
  | { state: "invalid"; message: string };

interface AddressDraft {
  line1: string;
  line2: string;
  area: string;
  city: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressDraft = {
  area: "",
  city: "",
  line1: "",
  line2: "",
  postalCode: "",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardPanel className="grid gap-4 p-4">{children}</CardPanel>
    </Card>
  );
}

/** A radio with its label as one card, the way the mockup lays out zones and methods. */
function ChoiceCard({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <Label className="border-border has-data-checked:border-foreground/40 has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm font-normal">
      <Radio value={value} className="mt-0.5" />
      <span className="min-w-0">{children}</span>
    </Label>
  );
}

function NewOrder() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();

  usePageTrail([
    { label: "Orders", to: "/shop/orders" },
    { label: "New order" },
  ]);

  const session = useQuery({
    queryFn: loadSession,
    queryKey: ["admin-session"],
  });
  const role = session.data?.user.role;
  const canConfirmMoney = role === ADMIN_ROLE || role === SUPERADMIN_ROLE;
  const staffName = session.data?.user.name ?? "you";

  // Customer --------------------------------------------------------------------------
  const [phone, setPhone] = useState("");
  const [typedName, setTypedName] = useState("");
  const [askedPhone, setAskedPhone] = useState("");

  // The lookup waits until typing pauses, then asks once per number.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAskedPhone(phone.trim());
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [phone]);

  const asked = useQuery({
    enabled: phoneReady(askedPhone),
    queryFn: () => lookupCustomer(askedPhone),
    queryKey: ["admin", "shop", "lookup", askedPhone],
    retry: false,
  });
  const lookup = lookupState(phone, askedPhone, asked);
  // A known buyer's own name fills the field until staff type another.
  const name =
    typedName.trim() === "" && lookup.state === "known"
      ? lookup.customer.name
      : typedName;

  const known = lookup.state === "known" ? lookup.customer : null;
  const saved = useQuery({
    ...customerQuery(known?.id ?? ""),
    enabled: known !== null,
  });
  const savedAddresses = known ? (saved.data?.addresses ?? []) : [];

  // Items -----------------------------------------------------------------------------
  // The picker searches the active products by a part of the title or a SKU, on the api,
  // so a product past the first page is reachable. The search waits until typing pauses.
  const [productSearch, setProductSearch] = useState("");
  const [askedSearch, setAskedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setAskedSearch(productSearch.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [productSearch]);
  const products = useQuery(productsQuery("active", 1, askedSearch));
  const [productId, setProductId] = useState<string | null>(null);
  const product = useQuery({
    ...productQuery(productId ?? ""),
    enabled: productId !== null,
  });
  const [lines, setLines] = useState<DraftLine[]>([]);

  // Delivery --------------------------------------------------------------------------
  // Null until staff pick: a known buyer's first saved address (the default) and its zone
  // are picked for them, and a new number types an address.
  const [pickedAddress, setPickedAddress] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);
  const zones = useQuery(zonesQuery());
  const activeZones = (zones.data?.zones ?? []).filter((zone) => zone.active);
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const [firstSaved] = savedAddresses;
  const addressChoice = pickedAddress ?? firstSaved?.id ?? "new";
  const zoneId = pickedZone ?? firstSaved?.zoneId ?? null;
  const zone = activeZones.find((item) => item.id === zoneId) ?? null;

  // Payment ---------------------------------------------------------------------------
  const methods = useQuery(paymentMethodsQuery);
  const [pickedMethod, setPickedMethod] = useState<string | null>(null);
  const method = pickedMethod ?? methods.data?.methods[0]?.id ?? null;
  const [received, setReceived] = useState(false);
  const [transactionId, setTransactionId] = useState("");
  const takesId = method !== null && method !== COD_METHOD;

  const totals = draftTotals(lines, zone?.rate ?? 0);

  // Submit ----------------------------------------------------------------------------
  const chosenSaved = savedAddresses.find((item) => item.id === addressChoice);
  const missing: string[] = [];
  if (!phoneReady(phone) || lookup.state === "invalid") {
    missing.push("a phone number");
  }
  if (name.trim() === "") {
    missing.push("the buyer's name");
  }
  if (lines.length === 0) {
    missing.push("one or more items");
  }
  if (
    !chosenSaved &&
    (address.line1.trim() === "" || address.city.trim() === "")
  ) {
    missing.push("an address with a street and a city");
  }
  if (zone === null) {
    missing.push("a shipping zone");
  }
  if (method === null) {
    missing.push("a payment method");
  }
  if (received && takesId && transactionId.trim() === "") {
    missing.push("the transaction ID");
  }

  const create = useMutation({
    mutationFn: async () => {
      const body: ManualOrderBody = {
        address: chosenSaved
          ? {
              area: chosenSaved.area,
              city: chosenSaved.city,
              country: chosenSaved.country,
              line1: chosenSaved.line1,
              line2: chosenSaved.line2,
              name: name.trim(),
              phone: phone.trim(),
              postalCode: chosenSaved.postalCode,
            }
          : {
              area: address.area.trim() || null,
              city: address.city.trim(),
              country: "BD",
              line1: address.line1.trim(),
              line2: address.line2.trim() || null,
              name: name.trim(),
              phone: phone.trim(),
              postalCode: address.postalCode.trim() || null,
            },
        lines: lines.map((line) => ({
          quantity: line.quantity,
          variantId: line.variantId,
        })),
        name: name.trim(),
        paymentMethod: method ?? "",
        phone: phone.trim(),
        zoneId: zoneId ?? "",
        ...(received && takesId && canConfirmMoney
          ? { paymentReceived: { transactionId: transactionId.trim() } }
          : {}),
      };
      return createManualOrder(body);
    },
    onSuccess: async (result) => {
      toastManager.add({
        description: result.customer.existing
          ? `Linked to ${result.order.contactName}.`
          : "A customer account was made for this phone.",
        title: `Order ${result.order.label} created`,
        type: "success",
      });
      await refreshShop(queryClient);
      await navigate({
        params: { orderId: result.order.id },
        to: "/shop/orders/$orderId",
      });
    },
  });

  const matches = (products.data?.products ?? []).slice(0, 8);
  const variants = (product.data?.variants ?? []).filter(
    (variant) => variant.active
  );

  return (
    <PageLayout>
      <PageHeader
        title="New order"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              render={
                <Link to="/shop/orders" search={{ page: 1, status: "all" }} />
              }
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={missing.length > 0 || create.isPending}
              onClick={() => {
                create.mutate();
              }}
            >
              {create.isPending
                ? "Creating…"
                : `Create order ${money(totals.total, CURRENCY, SHOP_LOCALE)}`}
            </Button>
          </>
        }
      />
      <PageBody
        aside={
          <Card className="rounded-xl lg:sticky lg:top-4">
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-sm font-semibold">Summary</CardTitle>
            </CardHeader>
            <CardPanel className="grid gap-3 p-4 text-sm">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right tabular-nums">
                  {money(totals.subtotal, CURRENCY, SHOP_LOCALE)}
                </dd>
                <dt className="text-muted-foreground">
                  {zone ? `Shipping, ${zone.name}` : "Shipping"}
                </dt>
                <dd className="text-right tabular-nums">
                  {money(totals.shipping, CURRENCY, SHOP_LOCALE)}
                </dd>
                <dt className="border-border border-t pt-2 font-semibold">
                  Total
                </dt>
                <dd className="border-border border-t pt-2 text-right font-semibold tabular-nums">
                  {money(totals.total, CURRENCY, SHOP_LOCALE)}
                </dd>
              </dl>
              <p className="text-muted-foreground">
                The order starts as Placed. Its history records it as created by{" "}
                {staffName}.
              </p>
              {missing.length > 0 ? (
                <p className="text-muted-foreground">
                  To create it, add {missing.join(", ")}.
                </p>
              ) : null}
              {create.error ? (
                <p className="text-destructive" role="alert">
                  {create.error.message}
                </p>
              ) : null}
            </CardPanel>
          </Card>
        }
      >
        <div className="flex flex-col gap-4">
          <Section title="Customer">
            <Field>
              <FieldLabel htmlFor={`${ids}-phone`}>Phone</FieldLabel>
              <Input
                id={`${ids}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="01712345678"
                value={phone}
                aria-invalid={lookup.state === "invalid" ? true : undefined}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setPickedAddress(null);
                }}
              />
              <CustomerLine lookup={lookup} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-name`}>Name</FieldLabel>
              <Input
                id={`${ids}-name`}
                value={name}
                maxLength={120}
                onChange={(event) => {
                  setTypedName(event.target.value);
                }}
              />
            </Field>
          </Section>

          <Section title="Items">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-start">
              <Field>
                <FieldLabel htmlFor={`${ids}-product`}>Product</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id={`${ids}-product`}
                    type="search"
                    placeholder="Add a product"
                    autoComplete="off"
                    value={productSearch}
                    onChange={(event) => {
                      setProductSearch(event.target.value);
                    }}
                  />
                </InputGroup>
                <ul
                  aria-label="Matching products"
                  className="flex flex-col gap-1"
                >
                  {matches.length === 0 && !products.isFetching ? (
                    <li className="text-muted-foreground text-sm">
                      {askedSearch === ""
                        ? "No active product yet."
                        : `No active product matches "${askedSearch}".`}
                    </li>
                  ) : null}
                  {matches.map((item) => (
                    <li key={item.id}>
                      <Button
                        size="sm"
                        variant={item.id === productId ? "secondary" : "ghost"}
                        aria-pressed={item.id === productId}
                        className="w-full justify-between gap-2 text-left"
                        onClick={() => {
                          setProductId(item.id);
                        }}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {item.available > 0
                            ? `${String(item.available)} in stock`
                            : "Out of stock"}
                        </span>
                      </Button>
                    </li>
                  ))}
                  {(products.data?.total ?? 0) > matches.length ? (
                    <li className="text-muted-foreground text-xs">
                      Type more of the name or the SKU to narrow the list.
                    </li>
                  ) : null}
                </ul>
              </Field>
              {productId === null ? null : (
                <ul
                  className="flex flex-col gap-1.5 sm:pt-6"
                  aria-label="Variants"
                >
                  {variants.length === 0 ? (
                    <li className="text-muted-foreground text-sm">
                      {product.isLoading
                        ? "Loading variants…"
                        : "No active variant."}
                    </li>
                  ) : null}
                  {variants.map((variant) => {
                    const price = variant.prices.find(
                      (item) => item.currency === CURRENCY
                    );
                    const { available } = variant.stock;
                    const title = [product.data?.title, variant.title]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <li key={variant.id}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-auto w-full justify-between gap-3 py-1.5 text-left"
                          disabled={available <= 0 || price === undefined}
                          onClick={() => {
                            if (price) {
                              setLines((current) =>
                                addLine(current, {
                                  available,
                                  sku: variant.sku,
                                  title,
                                  unitPrice: price.amount,
                                  variantId: variant.id,
                                })
                              );
                            }
                          }}
                        >
                          <span className="min-w-0 truncate">
                            {variant.title || product.data?.title}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {available > 0
                              ? `${available} in stock`
                              : "Out of stock"}
                            {price
                              ? `, ${money(price.amount, CURRENCY, SHOP_LOCALE)}`
                              : ""}
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Pick a product, then a variant, to add a line.
              </p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">The order lines.</caption>
                <thead className="text-muted-foreground text-xs">
                  <tr className="border-border border-b">
                    <th scope="col" className="py-2 text-left font-medium">
                      Product and variant
                    </th>
                    <th
                      scope="col"
                      className="hidden py-2 text-left font-medium sm:table-cell"
                    >
                      SKU
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Unit price
                    </th>
                    <th scope="col" className="py-2 text-center font-medium">
                      Quantity
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Line total
                    </th>
                    <th scope="col" className="w-8 py-2">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.variantId} className="border-border border-b">
                      <td className="py-2 pr-2">{line.title}</td>
                      <td className="text-muted-foreground hidden py-2 pr-2 font-mono text-xs sm:table-cell">
                        {line.sku ?? ""}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(line.unitPrice, CURRENCY, SHOP_LOCALE)}
                      </td>
                      <td className="py-2">
                        <span className="flex items-center justify-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="outline"
                            aria-label={`One fewer ${line.title}`}
                            onClick={() => {
                              setLines((current) =>
                                setLineQuantity(
                                  current,
                                  line.variantId,
                                  line.quantity - 1
                                )
                              );
                            }}
                          >
                            <MinusIcon />
                          </Button>
                          <span className="w-6 text-center tabular-nums">
                            {line.quantity}
                          </span>
                          <Button
                            size="icon-xs"
                            variant="outline"
                            aria-label={`One more ${line.title}`}
                            disabled={line.quantity >= line.available}
                            onClick={() => {
                              setLines((current) =>
                                setLineQuantity(
                                  current,
                                  line.variantId,
                                  line.quantity + 1
                                )
                              );
                            }}
                          >
                            <PlusIcon />
                          </Button>
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(
                          line.unitPrice * line.quantity,
                          CURRENCY,
                          SHOP_LOCALE
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${line.title}`}
                          onClick={() => {
                            setLines((current) =>
                              setLineQuantity(current, line.variantId, 0)
                            );
                          }}
                        >
                          <XIcon />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-muted-foreground text-xs">
              Prices come from the catalog.
            </p>
          </Section>

          <Section title="Delivery">
            {savedAddresses.length > 0 ? (
              <Field>
                <FieldLabel>Saved address</FieldLabel>
                <RadioGroup
                  value={addressChoice}
                  onValueChange={(next) => {
                    setPickedAddress(String(next));
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {savedAddresses.map((item) => (
                    <ChoiceCard key={item.id} value={item.id}>
                      {addressLines(item).map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                    </ChoiceCard>
                  ))}
                  <ChoiceCard value="new">A new address</ChoiceCard>
                </RadioGroup>
              </Field>
            ) : null}
            {chosenSaved ? null : (
              <div className="grid gap-3 sm:grid-cols-2">
                <AddressField
                  label="Address line 1"
                  value={address.line1}
                  wide
                  onChange={(line1) => {
                    setAddress((current) => ({ ...current, line1 }));
                  }}
                />
                <AddressField
                  label="Address line 2 (optional)"
                  value={address.line2}
                  wide
                  onChange={(line2) => {
                    setAddress((current) => ({ ...current, line2 }));
                  }}
                />
                <AddressField
                  label="Area (optional)"
                  value={address.area}
                  onChange={(area) => {
                    setAddress((current) => ({ ...current, area }));
                  }}
                />
                <AddressField
                  label="City"
                  value={address.city}
                  onChange={(city) => {
                    setAddress((current) => ({ ...current, city }));
                  }}
                />
                <AddressField
                  label="Postal code (optional)"
                  value={address.postalCode}
                  onChange={(postalCode) => {
                    setAddress((current) => ({ ...current, postalCode }));
                  }}
                />
              </div>
            )}
            <Field>
              <FieldLabel>Shipping zone</FieldLabel>
              {activeZones.length === 0 ? (
                <FieldDescription>
                  No active zone. Add one under{" "}
                  <Link to="/shop/shipping-zones" className="underline">
                    Shipping zones
                  </Link>
                  .
                </FieldDescription>
              ) : (
                <RadioGroup
                  value={zoneId ?? ""}
                  onValueChange={(next) => {
                    setPickedZone(String(next));
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {activeZones.map((item) => (
                    <ChoiceCard key={item.id} value={item.id}>
                      <span className="font-medium">{item.name}</span>{" "}
                      <span className="tabular-nums">
                        {money(item.rate, item.currency, SHOP_LOCALE)}
                      </span>
                    </ChoiceCard>
                  ))}
                </RadioGroup>
              )}
            </Field>
          </Section>

          <Section title="Payment">
            <RadioGroup
              aria-label="Payment method"
              value={method ?? ""}
              onValueChange={(next) => {
                setPickedMethod(String(next));
              }}
              className="grid gap-2 sm:grid-cols-3"
            >
              {(methods.data?.methods ?? []).map((item) => (
                <ChoiceCard key={item.id} value={item.id}>
                  {item.label}
                </ChoiceCard>
              ))}
            </RadioGroup>
            {methods.isError ? (
              <p className="text-destructive text-sm" role="alert">
                The payment methods did not load. Check PAYMENT_PROVIDER on the
                api.
              </p>
            ) : null}
            {takesId && canConfirmMoney ? (
              <div className="grid gap-2">
                <Label className="flex items-center gap-2.5 text-sm font-medium">
                  <Checkbox
                    checked={received}
                    onCheckedChange={(checked) => {
                      setReceived(checked);
                    }}
                  />
                  Payment already received
                </Label>
                {received ? (
                  <Field>
                    <FieldLabel htmlFor={`${ids}-txn`}>
                      Transaction ID
                    </FieldLabel>
                    <Input
                      id={`${ids}-txn`}
                      value={transactionId}
                      maxLength={100}
                      className="font-mono"
                      onChange={(event) => {
                        setTransactionId(event.target.value);
                      }}
                    />
                    <FieldDescription>
                      The payment is confirmed when the order is created. Check
                      the ID in the receiving account first.
                    </FieldDescription>
                  </Field>
                ) : (
                  // Plain text, not a FieldDescription: no Field wraps the checkbox,
                  // and a Field part outside a Field throws in Base UI.
                  <p className="text-muted-foreground text-sm">
                    Check it to record a payment the buyer already sent, with
                    its transaction ID.
                  </p>
                )}
              </div>
            ) : null}
            {takesId && !canConfirmMoney ? (
              <p className="text-muted-foreground text-sm">
                The buyer pays after the order is placed. An admin confirms the
                payment from the order.
              </p>
            ) : null}
          </Section>
        </div>
      </PageBody>
    </PageLayout>
  );
}

/** What the phone lookup says now, from the typed number and the last answer. */
function lookupState(
  phone: string,
  askedPhone: string,
  asked: {
    data: LookedUpCustomer | null | undefined;
    error: Error | null;
    isFetching: boolean;
  }
): Lookup {
  if (!phoneReady(phone)) {
    return { state: "idle" };
  }
  if (phone.trim() !== askedPhone || asked.isFetching) {
    return { state: "looking" };
  }
  if (asked.error) {
    return {
      message:
        asked.error instanceof ShopRequestError && asked.error.status === 400
          ? "Enter a mobile number, such as 01712345678."
          : "The phone lookup failed. Try again.",
      state: "invalid",
    };
  }
  if (asked.data) {
    return { customer: asked.data, state: "known" };
  }
  return asked.data === null ? { state: "new" } : { state: "looking" };
}

/** The line under the phone: the lookup's answer, one of the two, never both. */
function CustomerLine({ lookup }: { lookup: Lookup }) {
  switch (lookup.state) {
    case "looking": {
      return <FieldDescription>Looking up this number…</FieldDescription>;
    }
    case "invalid": {
      return (
        <p className="text-destructive text-sm" role="alert">
          {lookup.message}
        </p>
      );
    }
    case "known": {
      const { customer } = lookup;
      const orders =
        customer.orderCount === 1 ? "1 order" : `${customer.orderCount} orders`;
      return (
        <p
          className="flex flex-wrap items-center gap-2 text-sm"
          aria-live="polite"
        >
          <span>
            {customer.name}, {orders}, customer since{" "}
            {shownDay(customer.createdAt)}
          </span>
          <Badge variant="success">Existing customer</Badge>
        </p>
      );
    }
    case "new": {
      return (
        <FieldDescription aria-live="polite">
          A new number creates a customer account. The customer signs in later
          with a code sent to this phone.
        </FieldDescription>
      );
    }
    default: {
      // `idle`: no full number yet.
      return (
        <FieldDescription>
          A known number links the order to its customer.
        </FieldDescription>
      );
    }
  }
}

function AddressField({
  label,
  value,
  wide = false,
  onChange,
}: {
  label: string;
  value: string;
  wide?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field className={wide ? "sm:col-span-2" : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={200}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
