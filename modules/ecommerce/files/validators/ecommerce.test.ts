// Tests for the ecommerce request bodies and queries. Repo-only.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { ORDER_STATUSES } from "../src/status.ts";
// `./phone` is a sibling only in a generated project, where both files land in
// `packages/validators/src/`. Here it lives in `modules/validators`, so the hook below maps
// the import onto the real file before `./ecommerce.ts` loads.
const PHONE = new URL("../../../validators/files/src/phone.ts", import.meta.url)
  .href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./phone" &&
      context.parentURL?.endsWith("/ecommerce.ts")
    ) {
      return { shortCircuit: true, url: PHONE };
    }
    return nextResolve(specifier, context);
  },
});

const {
  addressInput,
  cartItemInput,
  cartItemUpdateInput,
  checkoutInput,
  currencyCode,
  ECOMMERCE_ORDER_STATUSES,
  manualOrderInput,
  minorAmount,
  orderListQuery,
  orderStatusInput,
  productInput,
  productOptionsInput,
  shippingZoneInput,
  shopPhone,
  stockAdjustInput,
  variantInput,
} = await import("./ecommerce.ts");

const ADDRESS = {
  name: "Rahim",
  phone: "01712345678",
  line1: "House 12, Road 7",
  city: "Dhaka",
};

describe("the order status list", () => {
  it("matches @repo/ecommerce's ORDER_STATUSES", () => {
    assert.deepEqual([...ECOMMERCE_ORDER_STATUSES], [...ORDER_STATUSES]);
  });
});

describe("money", () => {
  it("takes a whole non-negative amount and refuses a fraction", () => {
    assert.equal(minorAmount.safeParse(125_050).success, true);
    assert.equal(minorAmount.safeParse(1.5).success, false);
    assert.equal(minorAmount.safeParse(-1).success, false);
  });

  it("takes an ISO 4217 code only", () => {
    assert.equal(currencyCode.safeParse("BDT").success, true);
    assert.equal(currencyCode.safeParse("bdt").success, false);
  });
});

describe("shopPhone", () => {
  it("normalizes a Bangladeshi mobile and keeps another E.164 number", () => {
    assert.equal(shopPhone.parse("017-1234 5678"), "+8801712345678");
    assert.equal(shopPhone.parse("+447911123456"), "+447911123456");
  });

  it("refuses text and a short number", () => {
    assert.equal(shopPhone.safeParse("call me").success, false);
    assert.equal(shopPhone.safeParse("12345").success, false);
  });
});

describe("productInput", () => {
  it("takes a title and slug, and defaults the rest", () => {
    assert.deepEqual(productInput.parse({ title: "Tee", slug: "tee" }), {
      categoryId: null,
      description: null,
      slug: "tee",
      title: "Tee",
    });
  });

  it("refuses a blank title and a bad slug", () => {
    assert.equal(
      productInput.safeParse({ title: " ", slug: "tee" }).success,
      false
    );
    assert.equal(
      productInput.safeParse({ title: "Tee", slug: "Cotton Tee" }).success,
      false
    );
  });
});

describe("productOptionsInput", () => {
  it("takes up to three options with distinct values", () => {
    const body = {
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Colour", values: ["Red"] },
      ],
    };
    assert.equal(productOptionsInput.safeParse(body).success, true);
  });

  it("refuses a repeated value, a repeated name and a fourth option", () => {
    for (const options of [
      [{ name: "Size", values: ["S", "S"] }],
      [
        { name: "Size", values: ["S"] },
        { name: "size", values: ["M"] },
      ],
      ["A", "B", "C", "D"].map((name) => ({ name, values: ["x"] })),
    ]) {
      assert.equal(productOptionsInput.safeParse({ options }).success, false);
    }
  });
});

describe("variantInput and stockAdjustInput", () => {
  it("lets a variant be unpriced", () => {
    assert.equal(
      variantInput.safeParse({ price: null, active: false }).success,
      true
    );
  });

  it("takes a delta or an on-hand count, never a zero delta", () => {
    assert.equal(stockAdjustInput.safeParse({ delta: -2 }).success, true);
    assert.equal(stockAdjustInput.safeParse({ onHand: 10 }).success, true);
    assert.equal(stockAdjustInput.safeParse({ delta: 0 }).success, false);
    assert.equal(stockAdjustInput.safeParse({ onHand: -1 }).success, false);
  });
});

describe("cart bodies", () => {
  it("takes a quantity of one or more to add, zero to remove", () => {
    assert.equal(
      cartItemInput.safeParse({ variantId: "v1", quantity: 1 }).success,
      true
    );
    assert.equal(
      cartItemInput.safeParse({ variantId: "v1", quantity: 0 }).success,
      false
    );
    assert.equal(cartItemUpdateInput.safeParse({ quantity: 0 }).success, true);
  });

  it("drops a price the browser sends", () => {
    const body = cartItemInput.parse({
      variantId: "v1",
      quantity: 1,
      price: 1,
    });
    assert.equal("price" in body, false);
  });
});

describe("checkoutInput", () => {
  it("takes a new address or a saved one, not both and not neither", () => {
    const base = { zoneId: "z1", paymentMethod: "cod" };
    assert.equal(
      checkoutInput.safeParse({ ...base, address: ADDRESS }).success,
      true
    );
    assert.equal(
      checkoutInput.safeParse({ ...base, addressId: "a1" }).success,
      true
    );
    assert.equal(checkoutInput.safeParse(base).success, false);
    assert.equal(
      checkoutInput.safeParse({ ...base, addressId: "a1", address: ADDRESS })
        .success,
      false
    );
  });

  it("strips any total, price or line the browser sends", () => {
    const body = checkoutInput.parse({
      zoneId: "z1",
      paymentMethod: "cod",
      address: ADDRESS,
      total: 1,
      lines: [{ variantId: "v1", unitPrice: 1 }],
    });
    assert.equal("total" in body, false);
    assert.equal("lines" in body, false);
  });
});

describe("addressInput", () => {
  it("normalizes the phone and defaults the country to BD", () => {
    const address = addressInput.parse(ADDRESS);
    assert.equal(address.phone, "+8801712345678");
    assert.equal(address.country, "BD");
  });
});

describe("manualOrderInput", () => {
  it("takes lines with no price and drops a sent price", () => {
    const body = manualOrderInput.parse({
      phone: "01712345678",
      name: "Rahim",
      lines: [{ variantId: "v1", quantity: 2, unitPrice: 1 }],
      address: ADDRESS,
      zoneId: "z1",
      paymentMethod: "cod",
    });
    assert.deepEqual(body.lines, [{ variantId: "v1", quantity: 2 }]);
  });

  it("refuses an order with no lines", () => {
    assert.equal(
      manualOrderInput.safeParse({
        phone: "01712345678",
        name: "Rahim",
        lines: [],
        address: ADDRESS,
        zoneId: "z1",
        paymentMethod: "cod",
      }).success,
      false
    );
  });
});

describe("orderStatusInput and orderListQuery", () => {
  it("refuses placed as a target and defaults restock to true", () => {
    assert.equal(
      orderStatusInput.safeParse({ status: "placed" }).success,
      false
    );
    assert.equal(orderStatusInput.parse({ status: "returned" }).restock, true);
  });

  it("reads the status filter and the COD flag from a query", () => {
    assert.deepEqual(orderListQuery.parse({ status: "placed", cod: "true" }), {
      cod: true,
      page: 1,
      status: "placed",
    });
    assert.equal(orderListQuery.safeParse({ status: "paid" }).success, false);
  });
});

describe("shippingZoneInput", () => {
  it("takes a name and a whole rate", () => {
    assert.equal(
      shippingZoneInput.safeParse({ name: "Inside Dhaka", rate: 6000 }).success,
      true
    );
    assert.equal(
      shippingZoneInput.safeParse({ name: "Inside Dhaka", rate: 60.5 }).success,
      false
    );
  });
});
