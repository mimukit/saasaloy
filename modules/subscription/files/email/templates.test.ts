// Tests that the three subscription emails render, and that each one carries the fact it exists
// to deliver. Repo-only, and it runs on `node:test` via `pnpm test:modules`.
//
// `./render.ts` and `./provider.ts` beside this file are resolution shims, not shipped
// files — see the header on `./render.ts`. They let these templates be exercised in place,
// against the real renderer from `modules/email`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountLocked } from "./templates/account-locked.ts";
import { paymentFailed } from "./templates/payment-failed.ts";
import { trialEnding } from "./templates/trial-ending.ts";

const SUBSCRIPTION_URL = "https://admin.example.com/subscription";

describe("trialEnding", () => {
  it("names the plan and the date in the subject and the body", () => {
    const message = trialEnding({
      appName: "Acme",
      subscriptionUrl: SUBSCRIPTION_URL,
      endsOn: "2026-10-01",
      name: "Ada",
      planName: "Pro",
    });

    assert.match(message.subject, /Acme/);
    assert.match(message.subject, /2026-10-01/);
    assert.match(message.html, /Pro/);
    assert.match(message.html, /2026-10-01/);
    assert.ok(message.html.includes(SUBSCRIPTION_URL));
  });

  it("escapes a name carrying markup", () => {
    const message = trialEnding({
      appName: "Acme",
      subscriptionUrl: SUBSCRIPTION_URL,
      endsOn: "2026-10-01",
      name: "<script>alert(1)</script>",
      planName: "Pro",
    });

    assert.ok(!message.html.includes("<script>"));
  });
});

describe("paymentFailed", () => {
  it("says the plan is still live and when that ends", () => {
    const message = paymentFailed({
      appName: "Acme",
      subscriptionUrl: SUBSCRIPTION_URL,
      lockoutOn: "2026-10-14",
      name: "Ada",
      planName: "Pro",
    });

    assert.match(message.subject, /Acme/);
    assert.match(message.html, /2026-10-14/);
    assert.match(message.html, /stays active/);
  });
});

describe("accountLocked", () => {
  it("names both the plan that stopped and the one now in force", () => {
    const message = accountLocked({
      appName: "Acme",
      subscriptionUrl: SUBSCRIPTION_URL,
      defaultPlanName: "Free",
      name: "Ada",
      planName: "Pro",
    });

    assert.match(message.html, /Pro/);
    assert.match(message.html, /Free/);
    // The reassurance is the load-bearing sentence: a locked account keeps its data.
    assert.match(message.html, /Nothing has been deleted/);
  });
});

describe("every subscription template", () => {
  it("refuses a link that is not an absolute https URL", () => {
    // `safeUrl` throws rather than render a link an inbox cannot resolve or should not
    // follow. Checked here because all three templates put a caller's URL in an `href`.
    for (const url of [
      "/subscription",
      "javascript:alert(1)",
      "http://evil.test",
    ]) {
      assert.throws(() =>
        accountLocked({
          appName: "Acme",
          subscriptionUrl: url,
          defaultPlanName: "Free",
          name: "Ada",
          planName: "Pro",
        })
      );
    }
  });

  it("accepts the localhost default a project starts with", () => {
    assert.doesNotThrow(() =>
      paymentFailed({
        appName: "Acme",
        subscriptionUrl: "http://localhost:3001/subscription",
        lockoutOn: "2026-10-14",
        name: "Ada",
        planName: "Pro",
      })
    );
  });
});
