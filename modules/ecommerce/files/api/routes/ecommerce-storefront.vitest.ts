import { createCategory } from "@repo/db/repositories/ecommerce/catalog";
import { testDatabase } from "@repo/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { makeVariant, makeZone } from "../lib/ecommerce/fixtures";
import {
  ADDRESS,
  answer,
  call,
  shopPayments,
  VERIFIED_PHONE,
} from "./ecommerce-fixtures";

// What the storefront in `apps/web` does, request by request (plan 0106, Phase 6): a guest
// fills a cart, verifies a new number by code and checks out with cash on delivery; a
// returning buyer signs in by code and checks out; the order page reads back what the
// order and payment pages show. The code comes from the console SMS provider's log, as
// in the `auth-phone` route tests.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();
shopPayments();

let log: MockInstance<typeof console.log>;
let phoneCounter = 0;

/** Expect `res` to answer `status`, and return it. */
function expectStatus(res: Response, status = 200): Response {
  expect(res.status, `${res.url} answers ${status}`).toBe(status);
  return res;
}

/** A Bangladeshi mobile no other test in this run has used. */
function newPhone(): string {
  phoneCounter += 1;
  const tail = `${Date.now() % 100_000}${phoneCounter}`
    .padStart(8, "0")
    .slice(-8);
  return `+88017${tail}`;
}

/** The last code the console provider sent to `phone`. */
function codeSentTo(phone: string): string {
  const texts = log.mock.calls
    .map((entry) => String(entry[0]))
    .filter((text) => text.includes(`to:         ${phone}\n`));
  const match = /(\d{4,10}) is your /.exec(texts.at(-1) ?? "");
  expect(match, `a code went to ${phone}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** Each `name=value` pair a response set, joined as one cookie header. */
function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/** `send-otp` then `verify` with the code, as the checkout's contact step does. */
async function verifyByCode(
  phone: string,
  options: { signIn?: boolean; cookie?: string } = {}
): Promise<{ send: Response; verify: Response }> {
  const flag = options.signIn ? { signIn: true } : {};
  const send = await call(database, "/auth/phone-number/send-otp", {
    body: { phoneNumber: phone, ...flag },
    cookie: options.cookie,
  });
  if (send.status !== 200) {
    return { send, verify: send };
  }
  const verify = await call(database, "/auth/phone-number/verify", {
    body: { code: codeSentTo(phone), phoneNumber: phone, ...flag },
    cookie: options.cookie,
  });
  return { send, verify };
}

describe("the storefront", () => {
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockReturnValue();
  });

  afterEach(() => {
    log.mockRestore();
  });

  describe("checkout", () => {
    it("lets a guest buy with cash on delivery after a code to a new number", async () => {
      const { variantId } = await makeVariant(database.db, {
        onHand: 4,
        price: 185_000,
      });
      const zoneId = await makeZone(database.db, 6000);
      const phone = newPhone();

      const added = await call(database, "/shop/cart/items", {
        body: { quantity: 2, variantId },
      });
      const guestCart = cookiesOf(expectStatus(added));

      // A new number signs up with the plain code: no flag.
      const { send, verify } = await verifyByCode(phone);
      expectStatus(send);
      const session = cookiesOf(expectStatus(verify));

      const cart = await call(database, "/shop/cart", {
        cookie: `${session}; ${guestCart}`,
      });
      await expect(answer(cart)).resolves.toMatchObject({
        body: { itemCount: 2, lines: [{ quantity: 2, variantId }] },
        status: 200,
      });

      const placed = await call(database, "/shop/checkout", {
        body: {
          address: { ...ADDRESS, phone },
          paymentMethod: "cod",
          saveAddress: true,
          zoneId,
        },
        cookie: session,
      });
      const body = (await expectStatus(placed, 201).json()) as {
        order: { number: number; contactPhone: string; status: string };
      };
      expect(body.order).toMatchObject({
        contactPhone: phone,
        status: "placed",
      });

      const page = await call(database, `/shop/orders/${body.order.number}`, {
        cookie: session,
      });
      await expect(answer(page)).resolves.toMatchObject({
        body: {
          holdExpiresAt: null,
          items: [{ image: null, quantity: 2 }],
          payments: [
            {
              instructions: { fields: [] },
              method: "cod",
              status: "pending",
            },
          ],
          status: "placed",
          total: 376_000,
        },
        status: 200,
      });

      const list = await call(database, "/shop/orders", { cookie: session });
      await expect(answer(list)).resolves.toMatchObject({
        body: { orders: [{ itemCount: 2, number: body.order.number }] },
        status: 200,
      });

      const saved = await call(database, "/shop/addresses", {
        cookie: session,
      });
      await expect(answer(saved)).resolves.toMatchObject({
        body: { addresses: [{ line1: ADDRESS.line1, phone, zoneId }] },
      });
    });

    it("signs a returning buyer in by code and checks out", async () => {
      const { variantId } = await makeVariant(database.db, { onHand: 2 });
      const zoneId = await makeZone(database.db);

      // The plain code refuses a known number: that is how checkout learns it is known.
      const plain = await call(database, "/auth/phone-number/send-otp", {
        body: { phoneNumber: VERIFIED_PHONE },
      });
      await expect(answer(plain)).resolves.toMatchObject({
        body: { code: "PHONE_NUMBER_EXIST" },
        status: 409,
      });

      const { send, verify } = await verifyByCode(VERIFIED_PHONE, {
        signIn: true,
      });
      expectStatus(send);
      const session = cookiesOf(expectStatus(verify));

      const added = await call(database, "/shop/cart/items", {
        body: { quantity: 1, variantId },
        cookie: session,
      });
      expectStatus(added);
      const placed = await call(database, "/shop/checkout", {
        body: { address: ADDRESS, paymentMethod: "cod", zoneId },
        cookie: session,
      });

      await expect(answer(placed)).resolves.toMatchObject({
        body: { order: { contactPhone: VERIFIED_PHONE, status: "placed" } },
        status: 201,
      });
    });

    it("shows a bKash order's instructions and hold, then takes the transaction id", async () => {
      const { variantId } = await makeVariant(database.db, {
        onHand: 2,
        price: 50_000,
      });
      const zoneId = await makeZone(database.db, 6000);
      const { verify } = await verifyByCode(newPhone());
      const session = cookiesOf(verify);
      await call(database, "/shop/cart/items", {
        body: { quantity: 1, variantId },
        cookie: session,
      });
      const placed = await call(database, "/shop/checkout", {
        body: { address: ADDRESS, paymentMethod: "bkash", zoneId },
        cookie: session,
      });
      const { order } = (await placed.json()) as { order: { number: number } };

      const page = await call(database, `/shop/orders/${order.number}`, {
        cookie: session,
      });
      const view = (await page.json()) as {
        holdExpiresAt: string | null;
        payments: {
          id: string;
          instructions: { account?: { number: string }; fields: unknown[] };
        }[];
      };
      expect(view.holdExpiresAt).not.toBeNull();
      expect(Date.parse(view.holdExpiresAt ?? "")).toBeGreaterThan(Date.now());
      expect(view.payments[0]?.instructions.account?.number).toBe(
        "01712345678"
      );
      expect(view.payments[0]?.instructions.fields).toHaveLength(3);

      const submitted = await call(
        database,
        `/shop/orders/${order.number}/payments/${view.payments[0]?.id}/submit`,
        {
          body: {
            amount: 56_000,
            senderAccount: "01811111111",
            transactionId: "8N7A6D5E4F",
          },
          cookie: session,
        }
      );
      await expect(answer(submitted)).resolves.toMatchObject({
        body: {
          holdExpiresAt: null,
          payments: [{ instructions: null, status: "submitted" }],
        },
        status: 200,
      });
    });
  });

  describe("GET /shop/categories", () => {
    it("lists the categories in position order", async () => {
      const suffix = Date.now().toString(36);
      await createCategory(database.db, {
        name: "Saree",
        position: 2,
        slug: `saree-${suffix}`,
      });
      await createCategory(database.db, {
        name: "Panjabi",
        position: 1,
        slug: `panjabi-${suffix}`,
      });

      const res = await call(database, "/shop/categories");
      const body = (await res.json()) as {
        categories: { name: string; slug: string }[];
      };

      expect(res.status).toBe(200);
      const mine = body.categories.filter((row) => row.slug.endsWith(suffix));
      expect(mine.map((row) => row.name)).toStrictEqual(["Panjabi", "Saree"]);
    });
  });

  describe("GET /shop/cart", () => {
    it("gives each line its product image, or null when it has none", async () => {
      const { variantId } = await makeVariant(database.db, { onHand: 2 });

      const res = await call(database, "/shop/cart/items", {
        body: { quantity: 1, variantId },
      });

      await expect(answer(res)).resolves.toMatchObject({
        body: { lines: [{ image: null, variantId }] },
        status: 200,
      });
    });
  });
});
