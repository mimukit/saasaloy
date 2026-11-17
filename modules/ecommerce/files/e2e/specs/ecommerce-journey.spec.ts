import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { SEED_ADMIN, URLS } from "../lib/project.ts";
import { smsCode, smsMark } from "../lib/sms.ts";

// The shop's whole order life, driven through the real screens (plan 0106, Phase 7). A
// guest adds a product to the cart, verifies a phone by code and places a cash-on-delivery
// order on `apps/web`. Staff confirm, ship and deliver it on `apps/admin` and confirm the
// cash. The order ends `delivered`, the payment `successful`, and the variant's on-hand
// stock is lower by the quantity bought. The second test lets two buyers race for the last
// unit: the one who places the order first gets it, and the other gets a clean refusal.
//
// It needs three things the module tags cannot say:
//
// - `SMS_PROVIDER=console` in `apps/api/.env`, as `lib/sms.ts` checks: each code is read
//   from the api's log.
// - The `cod` method on in `packages/payment/src/index.ts`:
//   `manual({ methods: { cod: {} } })`. `ecommerce` depends on `payment`, not on
//   `payment-manual`, and `payment-manual` switches no method on by itself. The spec
//   refuses with that line when the shop offers no `cod`.
// - One shipping zone or more. `pnpm db:seed`, which `prepare.ts` runs, writes two.
//
// Each run makes its own product (a unique slug) through the staff api, so a kept
// database never collides with an earlier run. Nothing is deleted afterwards; see
// `lib/fixtures.ts`.

const ADMIN_HEADERS = { origin: URLS.admin, "x-auth-audience": "admin" };

/** A number no other run used. `offset` keeps two buyers in one run apart. */
function buyerPhone(offset: number): string {
  const stamp = (Math.floor(Date.now() / 1000) + offset * 37) % 9800;
  // `0100` to `0199` hold the seed numbers; skip them, as `uniquePhone()` does.
  const line = stamp < 100 ? stamp : stamp + 100;
  return `+1202555${String(line).padStart(4, "0")}`;
}

interface StaffProduct {
  id: string;
  slug: string;
  title: string;
  variantId: string;
}

/** Answer the body of a staff api call, or fail with its status and text. */
async function staffJson<T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT",
  path: string,
  data?: unknown
): Promise<T> {
  const response = await request.fetch(`${URLS.api}/admin/shop${path}`, {
    data,
    headers: ADMIN_HEADERS,
    method,
  });
  expect(
    response.ok(),
    `${method} /admin/shop${path} answered ${String(response.status())}: ${await response.text()}`
  ).toBe(true);
  return (await response.json()) as T;
}

/** Sign the seeded admin in through the real login form. */
async function signInStaff(page: Page): Promise<void> {
  await page.goto(`${URLS.admin}/login`);
  await page.getByLabel("Email").fill(SEED_ADMIN.email);
  await page.getByLabel("Password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${URLS.admin}/`);
}

/** A new active product with one priced variant and `onHand` units in stock. */
async function createProduct(
  request: APIRequestContext,
  onHand: number
): Promise<StaffProduct> {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const title = `E2E kettle ${stamp}`;
  const created = await staffJson<{
    id: string;
    slug: string;
    variants: { id: string }[];
  }>(request, "POST", "/products", { slug: `e2e-kettle-${stamp}`, title });
  const variantId = created.variants[0]?.id;
  if (variantId === undefined) {
    throw new Error("A new product answered with no default variant.");
  }
  await staffJson(request, "PUT", `/variants/${variantId}`, {
    active: true,
    price: 45_000,
    sku: `E2E-${stamp}`,
  });
  await staffJson(request, "POST", `/variants/${variantId}/stock`, {
    note: "e2e journey",
    onHand,
  });
  await staffJson(request, "POST", `/products/${created.id}/status`, {
    status: "active",
  });
  return { id: created.id, slug: created.slug, title, variantId };
}

/** The variant's stock as staff see it. */
async function stockOf(
  request: APIRequestContext,
  product: StaffProduct
): Promise<{ onHand: number; available: number; reserved: number }> {
  const body = await staffJson<{
    variants: {
      id: string;
      stock: { onHand: number; available: number; reserved: number };
    }[];
  }>(request, "GET", `/products/${product.id}`);
  const variant = body.variants.find((row) => row.id === product.variantId);
  if (variant === undefined) {
    throw new Error(`Product ${product.id} no longer has its variant.`);
  }
  return variant.stock;
}

/** Refuse to run when the shop offers no cash on delivery, naming the line to add. */
async function assertCodOffered(request: APIRequestContext): Promise<void> {
  const response = await request.get(`${URLS.api}/shop/payment-methods`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { methods: { id: string }[] };
  expect(
    body.methods.map((method) => method.id),
    "The shop offers no cod method. Add payment-manual and turn cod on in packages/payment/src/index.ts: manual({ methods: { cod: {} } })."
  ).toContain("cod");
}

/**
 * Open a shop page and wait for its React islands. Astro drops the `ssr` attribute from
 * an island once it hydrates; a click before that lands on server HTML with no handler.
 */
async function openShopPage(page: Page, path: string): Promise<void> {
  await page.goto(`${URLS.web}${path}`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/** Open the product page and put `quantity` of it in the cart. */
async function addToCart(
  page: Page,
  product: StaffProduct,
  quantity: number
): Promise<void> {
  await openShopPage(page, `/shop/${product.slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: product.title })
  ).toBeVisible();
  const more = page.getByRole("button", { name: "One more" });
  for (let count = 1; count < quantity; count += 1) {
    await more.click();
  }
  await expect(
    page.getByRole("group", { name: "Quantity" }).locator("output")
  ).toHaveText(String(quantity));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart.")).toBeVisible();
}

/**
 * From the cart to the open Payment step: the phone code for a new number, then a new
 * address in the first shipping zone.
 */
async function checkoutToPayment(
  page: Page,
  phone: string,
  name: string
): Promise<void> {
  await openShopPage(page, "/shop/cart");
  await page.getByRole("link", { name: "Check out" }).click();
  await expect(page).toHaveURL(`${URLS.web}/shop/checkout`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

  const contact = page.getByRole("region", { exact: true, name: "Contact" });
  await contact.getByLabel("Name").fill(name);
  await contact.getByLabel("Phone").fill(phone);
  const mark = smsMark();
  await contact.getByRole("button", { name: "Send code" }).click();
  const code = await smsCode(phone, mark);
  const field = page.getByLabel("Code from the SMS");
  await field.click();
  await field.pressSequentially(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("region", { name: "Contact, done" })
  ).toContainText("Verified");

  const delivery = page.getByRole("region", { exact: true, name: "Delivery" });
  await delivery.getByLabel("Address line").fill("House 12, Road 7");
  await delivery.getByLabel("District").selectOption("Dhaka");
  await delivery
    .getByRole("group", { name: "Shipping zone" })
    .getByRole("radio")
    .first()
    .check();
  await delivery.getByRole("button", { name: "Continue to payment" }).click();
  await expect(
    page.getByRole("region", { exact: true, name: "Payment" })
  ).toBeVisible();
}

/** Pick cash on delivery and place the order. Answers the order number from the URL. */
async function placeCodOrder(page: Page): Promise<number> {
  const payment = page.getByRole("region", { exact: true, name: "Payment" });
  await payment.getByRole("radio", { name: /Cash on delivery/ }).check();
  await payment.getByRole("button", { name: /^Place order/ }).click();
  await expect(page).toHaveURL(new RegExp(`^${URLS.web}/shop/orders/\\d+$`));
  return Number(new URL(page.url()).pathname.split("/").at(-1));
}

/** The buyer's own view of an order, from the api, with the browser's session. */
async function buyerOrder(
  page: Page,
  number: number
): Promise<{ status: string; payments: { method: string; status: string }[] }> {
  const response = await page.request.get(`${URLS.api}/shop/orders/${number}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    status: string;
    payments: { method: string; status: string }[];
  };
}

/** The order page's title row: the order label and its status pill. */
function orderHeader(page: Page) {
  return page.getByRole("heading", { level: 1, name: /^Order / }).locator("..");
}

/** A fresh browser context: its own cookies, so its own guest cart and session. */
async function newBuyer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return await context.newPage();
}

test.describe(
  "shop journey",
  {
    tag: ["@ecommerce", "@admin", "@payment-manual", "@sms-console"],
  },
  () => {
    test("a guest buys with cash on delivery and staff deliver it", async ({
      browser,
      page,
    }) => {
      // A cold dev server compiles the shop and the admin screens on first visit.
      test.setTimeout(180_000);
      const quantity = 2;
      const startStock = 5;

      await signInStaff(page);
      await assertCodOffered(page.request);
      const product = await createProduct(page.request, startStock);

      // The guest: cart, phone code, delivery, cash on delivery.
      const buyer = await newBuyer(browser);
      await addToCart(buyer, product, quantity);
      await checkoutToPayment(buyer, buyerPhone(0), "Rahim Uddin");
      const number = await placeCodOrder(buyer);
      await expect(orderHeader(buyer)).toContainText("Placed");

      // The hold counts against available stock; on hand moves only at shipped.
      await expect(stockOf(page.request, product)).resolves.toMatchObject({
        available: startStock - quantity,
        onHand: startStock,
      });

      // Staff: open the order, then confirm, ship, deliver and take the cash.
      const listed = await staffJson<{
        orders: { id: string; number: number }[];
      }>(page.request, "GET", "/orders?status=placed");
      const row = listed.orders.find((order) => order.number === number);
      if (row === undefined) {
        throw new Error(`Order ${String(number)} is not in the placed list.`);
      }
      await page.goto(`${URLS.admin}/shop/orders/${row.id}`);

      for (const [button, done] of [
        ["Confirm order", "Order confirmed"],
        ["Mark shipped", "Marked shipped"],
        ["Mark delivered", "Marked delivered"],
      ] as const) {
        await page.getByRole("button", { exact: true, name: button }).click();
        await expect(page.getByText(done, { exact: true })).toBeVisible();
      }
      await page
        .getByRole("button", { exact: true, name: "Confirm cash received" })
        .first()
        .click();
      await expect(
        page.getByText("Cash confirmed", { exact: true })
      ).toBeVisible();

      // The result the plan names: delivered, successful, stock down by the quantity.
      await expect(buyerOrder(buyer, number)).resolves.toMatchObject({
        payments: [{ method: "cod", status: "successful" }],
        status: "delivered",
      });
      await expect(stockOf(page.request, product)).resolves.toMatchObject({
        available: startStock - quantity,
        onHand: startStock - quantity,
        reserved: 0,
      });

      // And the buyer's own page says so.
      await buyer.reload();
      await expect(orderHeader(buyer)).toContainText("Delivered");
      await expect(
        buyer
          .locator("section")
          .filter({ has: buyer.getByRole("heading", { name: "Payments" }) })
      ).toContainText("Cash on delivery");
      await expect(
        buyer
          .locator("section")
          .filter({ has: buyer.getByRole("heading", { name: "Payments" }) })
      ).toContainText("Paid");
      await buyer.context().close();
    });

    test("the second buyer of the last unit gets a clean refusal", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000);
      await signInStaff(page);
      await assertCodOffered(page.request);
      const product = await createProduct(page.request, 1);

      // Late reaches the Payment step first, while the unit is still free.
      const late = await newBuyer(browser);
      await addToCart(late, product, 1);
      await checkoutToPayment(late, buyerPhone(1), "Karim Ahmed");

      // Early takes the last unit.
      const early = await newBuyer(browser);
      await addToCart(early, product, 1);
      await checkoutToPayment(early, buyerPhone(2), "Sadia Islam");
      await placeCodOrder(early);

      // Late places the order and is told which item ran out. No order is written.
      const payment = late.getByRole("region", {
        exact: true,
        name: "Payment",
      });
      await payment.getByRole("button", { name: /^Place order/ }).click();
      await expect(payment.getByRole("alert")).toHaveText(
        `${product.title} sold out while you checked out. Remove it from the cart to place the order.`
      );
      await expect(late).toHaveURL(`${URLS.web}/shop/checkout`);
      const orders = await late.request.get(`${URLS.api}/shop/orders`);
      expect(orders.ok()).toBe(true);
      expect(((await orders.json()) as { orders: unknown[] }).orders).toEqual(
        []
      );

      // The cart says the line is sold out and keeps "Check out" off.
      await openShopPage(late, "/shop/cart");
      await expect(
        late.getByText("Sold out. Remove it to check out.")
      ).toBeVisible();
      await expect(late.getByRole("link", { name: "Check out" })).toHaveCount(
        0
      );

      // Stock: the one unit is held by the early order and nothing left the shelf.
      await expect(stockOf(page.request, product)).resolves.toMatchObject({
        available: 0,
        onHand: 1,
        reserved: 1,
      });
      await late.context().close();
      await early.context().close();
    });
  }
);
