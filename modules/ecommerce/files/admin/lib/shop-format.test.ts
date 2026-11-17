// Tests for ./shop-format.ts. Repo-only: the descriptor ships `shop-format.ts`, never this
// file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressLines,
  addLine,
  amountText,
  applyPrice,
  draftFromVariant,
  draftTotals,
  eventText,
  formatAddress,
  methodLabel,
  money,
  nextAction,
  parseAmount,
  percent,
  phoneReady,
  relativeTime,
  setLineQuantity,
  variantChanges,
  variantProblem,
} from "./shop-format.ts";
import type { NextActionInput } from "./shop-format.ts";

// Intl puts a no-break space between the code and the number.
const spaced = (text: string) => text.replaceAll("\u00A0", " ");

describe("money", () => {
  it("formats minor units with the currency's own exponent", () => {
    assert.equal(spaced(money(145_000, "BDT", "en")), "BDT 1,450.00");
    assert.equal(spaced(money(990, "JPY", "en")), "¥990");
  });
});

describe("parseAmount and amountText", () => {
  it("reads a typed amount exactly, in minor units", () => {
    assert.equal(parseAmount("1450", "BDT"), 145_000);
    assert.equal(parseAmount(" 1,450.5 ", "BDT"), 145_050);
    assert.equal(parseAmount("0.01", "BDT"), 1);
    assert.equal(parseAmount("990", "JPY"), 990);
  });

  it("refuses an amount it cannot read exactly", () => {
    assert.equal(parseAmount("", "BDT"), null);
    assert.equal(parseAmount("12.345", "BDT"), null);
    assert.equal(parseAmount("-5", "BDT"), null);
    assert.equal(parseAmount("1e3", "BDT"), null);
    assert.equal(parseAmount("9.5", "JPY"), null);
  });

  it("writes an amount back as a field holds it", () => {
    assert.equal(amountText(145_000, "BDT"), "1450");
    assert.equal(amountText(145_050, "BDT"), "1450.50");
    assert.equal(amountText(990, "JPY"), "990");
  });
});

describe("addressLines and formatAddress", () => {
  const address = {
    area: "Dhanmondi",
    city: "Dhaka",
    country: "BD",
    line1: "House 12, Road 7",
    line2: null,
    name: "Nusrat Jahan",
    phone: "+8801712345678",
    postalCode: "1209",
  };

  it("keeps a space or a comma between every part", () => {
    assert.deepEqual(addressLines(address), [
      "House 12, Road 7, Dhanmondi",
      "Dhaka 1209",
    ]);
    assert.equal(
      formatAddress(address),
      "House 12, Road 7, Dhanmondi, Dhaka 1209"
    );
  });

  it("drops the parts that are empty", () => {
    assert.deepEqual(
      addressLines({ ...address, area: " ", postalCode: null }),
      ["House 12, Road 7", "Dhaka"]
    );
  });

  it("names a country outside the home one", () => {
    assert.deepEqual(addressLines({ ...address, country: "IN" }, "BD"), [
      "House 12, Road 7, Dhanmondi",
      "Dhaka 1209",
      "IN",
    ]);
  });

  it("reads a stored address that is not an object as no lines", () => {
    assert.deepEqual(addressLines(null), []);
    assert.equal(formatAddress("x"), "");
  });
});

describe("methodLabel", () => {
  it("names cash on delivery and words a provider's id", () => {
    assert.equal(methodLabel("cod"), "Cash on delivery");
    assert.equal(methodLabel("bkash"), "Bkash");
    assert.equal(methodLabel("bank_transfer"), "Bank transfer");
    assert.equal(methodLabel(null), "No method");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-17T10:00:00.000Z");

  it("words the distance with spaces between number and unit", () => {
    assert.equal(
      relativeTime("2026-11-17T09:48:00.000Z", now, "en"),
      "12 min. ago"
    );
    assert.equal(
      relativeTime("2026-11-16T10:00:00.000Z", now, "en"),
      "yesterday"
    );
  });
});

describe("percent", () => {
  it("rounds a rate to a whole percent", () => {
    assert.equal(percent(0.8213, "en"), "82%");
    assert.equal(percent(0, "en"), "0%");
  });
});

describe("eventText", () => {
  it("names the staff member who moved the order", () => {
    assert.equal(
      eventText(
        {
          actorName: "Rafi Ahmed",
          actorType: "staff",
          fromStatus: "placed",
          toStatus: "confirmed",
        },
        "Nusrat Jahan"
      ),
      "Confirmed by Rafi Ahmed"
    );
  });

  it("names the buyer on a checkout and the system on its own moves", () => {
    assert.equal(
      eventText(
        {
          actorName: null,
          actorType: "system",
          fromStatus: null,
          toStatus: "placed",
        },
        "Nusrat Jahan"
      ),
      "Placed by Nusrat Jahan"
    );
    assert.equal(
      eventText(
        {
          actorName: null,
          actorType: "system",
          fromStatus: "placed",
          toStatus: "confirmed",
        },
        "Nusrat Jahan"
      ),
      "Confirmed automatically"
    );
  });

  it("names a removed staff account plainly", () => {
    assert.equal(
      eventText(
        {
          actorName: null,
          actorType: "staff",
          fromStatus: "confirmed",
          toStatus: "shipped",
        },
        "Nusrat Jahan"
      ),
      "Shipped by a staff member"
    );
  });
});

describe("the variant grid", () => {
  const variant = {
    active: true,
    id: "v1",
    prices: [
      { amount: 145_000, currency: "BDT" },
      { amount: 1500, currency: "USD" },
    ],
    sku: "PNJ-IND-M",
    stock: { onHand: 10 },
  };

  it("starts a draft from the stored variant in the store currency", () => {
    assert.deepEqual(draftFromVariant(variant, "BDT"), {
      active: true,
      id: "v1",
      price: "1450",
      sku: "PNJ-IND-M",
      stock: "10",
    });
  });

  it("finds which half of a row changed", () => {
    const saved = draftFromVariant(variant, "BDT");
    assert.deepEqual(variantChanges(saved, saved), {
      stock: false,
      variant: false,
    });
    assert.deepEqual(variantChanges(saved, { ...saved, stock: "12" }), {
      stock: true,
      variant: false,
    });
    assert.deepEqual(variantChanges(saved, { ...saved, price: "1450.00" }), {
      stock: false,
      variant: false,
    });
    assert.deepEqual(variantChanges(saved, { ...saved, price: "1500" }), {
      stock: false,
      variant: true,
    });
  });

  it("says what stops a row from saving", () => {
    const saved = draftFromVariant(variant, "BDT");
    assert.equal(variantProblem(saved, "BDT"), null);
    assert.equal(
      variantProblem({ ...saved, price: "" }, "BDT"),
      "Add a price to activate"
    );
    assert.equal(
      variantProblem({ ...saved, active: false, price: "" }, "BDT"),
      null
    );
    assert.equal(
      variantProblem({ ...saved, price: "14.505" }, "BDT"),
      "Use an amount such as 1450 or 1450.50"
    );
    assert.equal(
      variantProblem({ ...saved, stock: "-1" }, "BDT"),
      "Stock is a whole number, 0 or more"
    );
  });

  it("sets one price on every row", () => {
    const rows = [
      draftFromVariant(variant, "BDT"),
      { ...draftFromVariant(variant, "BDT"), id: "v2", price: "" },
    ];
    assert.deepEqual(
      applyPrice(rows, "1500").map((row) => row.price),
      ["1500", "1500"]
    );
  });
});

describe("nextAction", () => {
  const base: NextActionInput = {
    paymentMethod: "cod",
    payments: [
      { reviewable: true, status: "pending", takesNoSubmission: true },
    ],
    refundDue: false,
    restocked: false,
    status: "placed",
  };

  it("asks for a call on a placed COD order", () => {
    const next = nextAction(base);
    assert.equal(next.primary?.action, "confirm");
    assert.deepEqual(
      next.secondary.map((step) => step.action),
      ["cancel"]
    );
  });

  it("waits on an unpaid online order, and offers the review once it is submitted", () => {
    const waiting = nextAction({
      ...base,
      paymentMethod: "bkash",
      payments: [
        { reviewable: false, status: "pending", takesNoSubmission: false },
      ],
    });
    assert.equal(waiting.primary, null);
    const submitted = nextAction({
      ...base,
      paymentMethod: "bkash",
      payments: [
        { reviewable: true, status: "submitted", takesNoSubmission: false },
      ],
    });
    assert.equal(submitted.primary?.action, "confirmPayment");
  });

  it("ships a confirmed order and delivers a shipped one", () => {
    assert.equal(
      nextAction({ ...base, status: "confirmed" }).primary?.action,
      "ship"
    );
    const shipped = nextAction({ ...base, status: "shipped" });
    assert.equal(shipped.primary?.action, "deliver");
    assert.deepEqual(
      shipped.secondary.map((step) => step.action),
      ["return"]
    );
  });

  it("asks for the cash on a delivered COD order until it is confirmed", () => {
    assert.equal(
      nextAction({ ...base, status: "delivered" }).primary?.action,
      "confirmPayment"
    );
    const done = nextAction({
      ...base,
      payments: [
        { reviewable: false, status: "successful", takesNoSubmission: true },
      ],
      status: "delivered",
    });
    assert.equal(done.primary, null);
    assert.equal(done.tone, "ok");
  });

  it("puts a due refund first on a closed order", () => {
    const next = nextAction({ ...base, refundDue: true, status: "cancelled" });
    assert.equal(next.primary?.action, "recordRefund");
    assert.equal(next.tone, "warn");
  });

  it("offers a restock once on a returned order", () => {
    assert.equal(
      nextAction({ ...base, status: "returned" }).primary?.action,
      "restock"
    );
    assert.equal(
      nextAction({ ...base, restocked: true, status: "returned" }).primary,
      null
    );
  });
});

describe("the New order lines", () => {
  const shirt = {
    available: 2,
    sku: "PNJ-IND-M",
    title: "Cotton panjabi, Indigo / M",
    unitPrice: 145_000,
    variantId: "v1",
  };

  it("adds a variant once, then counts it up to the stock available", () => {
    let lines = addLine([], shirt);
    assert.equal(lines[0]?.quantity, 1);
    lines = addLine(lines, shirt);
    lines = addLine(lines, shirt);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.quantity, 2);
  });

  it("does not add a sold-out variant", () => {
    assert.deepEqual(addLine([], { ...shirt, available: 0 }), []);
  });

  it("caps a typed quantity and removes a line at zero", () => {
    const lines = addLine([], shirt);
    assert.equal(setLineQuantity(lines, "v1", 9)[0]?.quantity, 2);
    assert.deepEqual(setLineQuantity(lines, "v1", 0), []);
  });

  it("adds the shipping to the subtotal", () => {
    const lines = setLineQuantity(addLine([], shirt), "v1", 2);
    assert.deepEqual(draftTotals(lines, 6000), {
      shipping: 6000,
      subtotal: 290_000,
      total: 296_000,
    });
  });
});

describe("phoneReady", () => {
  it("waits for a full number", () => {
    assert.equal(phoneReady("0171"), false);
    assert.equal(phoneReady("01712345678"), true);
    assert.equal(phoneReady("+880 1712-345678"), true);
    assert.equal(phoneReady("call me"), false);
  });
});
