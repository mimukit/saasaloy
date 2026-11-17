// Tests for the storefront client and its page helpers. Repo-only: the descriptor ships
// `client.ts`, never this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressLines,
  cartLineNotice,
  createShopClient,
  initialSelection,
  itemsText,
  orderPath,
  orderTrack,
  priceFrom,
  productPath,
  ShopClientError,
  shopDate,
  valueState,
  variantFor,
} from "./client.ts";
import type { ShopProduct } from "./client.ts";

const PRODUCT: ShopProduct = {
  categoryId: null,
  currency: "BDT",
  descriptionHtml: "",
  id: "p1",
  images: [],
  options: [
    {
      id: "colour",
      name: "Colour",
      values: [
        { id: "maroon", value: "Maroon" },
        { id: "indigo", value: "Indigo" },
      ],
    },
    {
      id: "size",
      name: "Size",
      values: [
        { id: "m", value: "M" },
        { id: "xl", value: "XL" },
      ],
    },
  ],
  slug: "kurti",
  title: "Kurti",
  variants: [
    variant("v1", ["maroon", "m"], 0),
    variant("v2", ["maroon", "xl"], 3),
    variant("v3", ["indigo", "m"], 2),
  ],
};

function variant(id: string, values: string[], available: number) {
  return {
    available,
    id,
    optionValueIds: values,
    price: 185_000,
    sku: null,
    title: values.join(" / "),
  };
}

describe("variantFor", () => {
  it("finds the variant whose values match the selection, in any order", () => {
    assert.equal(
      variantFor(PRODUCT, { colour: "maroon", size: "xl" })?.id,
      "v2"
    );
    assert.equal(
      variantFor(PRODUCT, { size: "m", colour: "indigo" })?.id,
      "v3"
    );
  });

  it("answers undefined for a combination no variant sells or a half selection", () => {
    assert.equal(
      variantFor(PRODUCT, { colour: "indigo", size: "xl" }),
      undefined
    );
    assert.equal(variantFor(PRODUCT, { colour: "maroon" }), undefined);
  });

  it("takes the one variant of a product with no options", () => {
    const plain = {
      ...PRODUCT,
      options: [],
      variants: [variant("only", [], 4)],
    };
    assert.equal(variantFor(plain, {})?.id, "only");
  });
});

describe("valueState", () => {
  it("tells a value in stock from one sold out and one no variant sells", () => {
    const picked = { colour: "maroon", size: "xl" };
    assert.equal(valueState(PRODUCT, picked, "size", "xl"), "available");
    assert.equal(valueState(PRODUCT, picked, "size", "m"), "sold_out");
    assert.equal(
      valueState(PRODUCT, { colour: "indigo", size: "m" }, "size", "xl"),
      "missing"
    );
  });
});

describe("initialSelection", () => {
  it("starts on the first variant with stock", () => {
    assert.deepEqual(initialSelection(PRODUCT), {
      colour: "maroon",
      size: "xl",
    });
  });

  it("falls back to the first variant when nothing is in stock", () => {
    const empty = {
      ...PRODUCT,
      variants: PRODUCT.variants.map((row) => ({ ...row, available: 0 })),
    };
    assert.deepEqual(initialSelection(empty), { colour: "maroon", size: "m" });
  });
});

describe("priceFrom", () => {
  it("says From only when the variants differ in price", () => {
    assert.deepEqual(priceFrom({ maxPrice: 200, minPrice: 100 }), {
      amount: 100,
      from: true,
    });
    assert.deepEqual(priceFrom({ maxPrice: 100, minPrice: 100 }), {
      amount: 100,
      from: false,
    });
    assert.equal(priceFrom({ maxPrice: null, minPrice: null }), null);
  });
});

describe("addressLines", () => {
  it("keeps every part apart with a comma or a line, never run together", () => {
    assert.deepEqual(
      addressLines({
        area: "Dhanmondi",
        city: "Dhaka",
        line1: "House 12, Road 5",
        line2: null,
        postalCode: "1209",
      }),
      ["House 12, Road 5", "Dhanmondi, Dhaka 1209"]
    );
    assert.deepEqual(
      addressLines({ city: "Sylhet", line1: "Zindabazar", line2: "Flat 3B" }),
      ["Zindabazar", "Flat 3B", "Sylhet"]
    );
  });

  it("skips blank parts", () => {
    assert.deepEqual(
      addressLines({ area: "  ", city: "Khulna", line1: "Road 1" }),
      ["Road 1", "Khulna"]
    );
  });
});

describe("cartLineNotice", () => {
  it("names a line above the stock, one no longer sold, and a sold out one", () => {
    assert.equal(
      cartLineNotice({ available: 2, forSale: true, quantity: 3 }),
      "Only 2 left. Lower the quantity to 2 to check out."
    );
    assert.equal(
      cartLineNotice({ available: 0, forSale: true, quantity: 1 }),
      "Sold out. Remove it to check out."
    );
    assert.equal(
      cartLineNotice({ available: 5, forSale: false, quantity: 1 }),
      "No longer for sale. Remove it to check out."
    );
    assert.equal(
      cartLineNotice({ available: 5, forSale: true, quantity: 1 }),
      null
    );
  });
});

describe("orderTrack", () => {
  it("marks the steps up to the status done and the status current", () => {
    assert.deepEqual(
      orderTrack("shipped").map((step) => [step.status, step.state]),
      [
        ["placed", "done"],
        ["confirmed", "done"],
        ["shipped", "current"],
        ["delivered", "todo"],
      ]
    );
  });

  it("shows no track for a cancelled or returned order", () => {
    assert.deepEqual(orderTrack("cancelled"), []);
    assert.deepEqual(orderTrack("returned"), []);
  });
});

describe("paths and words", () => {
  it("builds paths under the base path", () => {
    assert.equal(
      productPath("/shop", "jamdani saree"),
      "/shop/jamdani%20saree"
    );
    assert.equal(orderPath("/shop/", 1042), "/shop/orders/1042");
  });

  it("counts items", () => {
    assert.equal(itemsText(1), "1 item");
    assert.equal(itemsText(3), "3 items");
  });

  it("formats a date with the day, the short month and the year apart", () => {
    const text = shopDate("2026-11-16T09:20:00.000Z", "en-GB", "Asia/Dhaka");
    assert.equal(text, "16 Nov 2026");
    const withTime = shopDate(
      "2026-11-16T09:20:00.000Z",
      "en-GB",
      "Asia/Dhaka",
      {
        time: true,
      }
    );
    assert.equal(withTime, "16 Nov 2026, 15:20");
  });
});

describe("createShopClient", () => {
  function fakeFetch(reply: (url: string, init: RequestInit) => Response): {
    calls: { url: string; init: RequestInit }[];
    fetch: typeof fetch;
  } {
    const calls: { url: string; init: RequestInit }[] = [];
    return {
      calls,
      fetch: (input, init = {}) => {
        const url = String(input);
        calls.push({ init, url });
        return Promise.resolve(reply(url, init));
      },
    };
  }

  it("refuses to start with no api origin", () => {
    assert.throws(() => createShopClient({ apiUrl: "" }), /PUBLIC_API_URL/);
  });

  it("sends the session cookie and json, under /shop on the api origin", async () => {
    const fake = fakeFetch(() =>
      Response.json({ currency: "BDT", lines: [] }, { status: 200 })
    );
    const client = createShopClient({
      apiUrl: "http://localhost:4000/",
      fetch: fake.fetch,
    });

    await client.addToCart("v1", 2);

    const [call] = fake.calls;
    assert.equal(call?.url, "http://localhost:4000/shop/cart/items");
    assert.equal(call?.init.method, "POST");
    assert.equal(call?.init.credentials, "include");
    assert.equal(
      call?.init.body,
      JSON.stringify({ quantity: 2, variantId: "v1" })
    );
  });

  it("reads the catalog query and encodes a slug", async () => {
    const fake = fakeFetch(() => Response.json({}, { status: 200 }));
    const client = createShopClient({
      apiUrl: "http://api.test",
      fetch: fake.fetch,
    });

    await client.products({ category: "home", page: 2 });
    await client.product("a b");

    assert.equal(
      fake.calls[0]?.url,
      "http://api.test/shop/products?page=2&category=home"
    );
    assert.equal(fake.calls[1]?.url, "http://api.test/shop/products/a%20b");
  });

  it("answers null for a product the api does not sell", async () => {
    const fake = fakeFetch(() =>
      Response.json(
        { error: { code: "not_found", message: "No such product." } },
        { status: 404 }
      )
    );
    const client = createShopClient({
      apiUrl: "http://api.test",
      fetch: fake.fetch,
    });

    assert.equal(await client.product("gone"), null);
  });

  it("throws the api's code and message on a refusal", async () => {
    const fake = fakeFetch(() =>
      Response.json(
        { error: { code: "out_of_stock", message: "Only 1 left." } },
        { status: 409 }
      )
    );
    const client = createShopClient({
      apiUrl: "http://api.test",
      fetch: fake.fetch,
    });

    await assert.rejects(client.addToCart("v1", 3), (error: unknown) => {
      assert.ok(error instanceof ShopClientError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "out_of_stock");
      assert.equal(error.message, "Only 1 left.");
      return true;
    });
  });

  it("reads a refusal with no envelope as a failure with a plain message", async () => {
    const fake = fakeFetch(() => new Response("bad gateway", { status: 502 }));
    const client = createShopClient({
      apiUrl: "http://api.test",
      fetch: fake.fetch,
    });

    await assert.rejects(client.cart(), (error: unknown) => {
      assert.ok(error instanceof ShopClientError);
      assert.equal(error.code, "failed");
      assert.equal(error.status, 502);
      return true;
    });
  });

  it("calls a stopped api unreachable", async () => {
    const client = createShopClient({
      apiUrl: "http://api.test",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await assert.rejects(client.zones(), (error: unknown) => {
      assert.ok(error instanceof ShopClientError);
      assert.equal(error.code, "unreachable");
      return true;
    });
  });
});
