// Tests that the three billing emails render, and that each one carries the fact it exists
// to deliver, against the real renderer from the email capability. It ships as
// `templates.test.ts` when testing is on, and `pnpm test:modules` runs it in place on
// Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { accountLocked } from "./templates/account-locked";
import { paymentFailed } from "./templates/payment-failed";
import { trialEnding } from "./templates/trial-ending";

const BILLING_URL = "https://admin.example.com/billing";

describe(trialEnding, () => {
  it("names the plan and the date in the subject and the body", () => {
    const message = trialEnding({
      appName: "Acme",
      billingUrl: BILLING_URL,
      endsOn: "2026-10-01",
      name: "Ada",
      planName: "Pro",
    });

    expect(message.subject).toMatch(/Acme/);
    expect(message.subject).toMatch(/2026-10-01/);
    expect(message.html).toMatch(/Pro/);
    expect(message.html).toMatch(/2026-10-01/);
    expect(message.html.includes(BILLING_URL)).toBeTruthy();
  });

  it("escapes a name carrying markup", () => {
    const message = trialEnding({
      appName: "Acme",
      billingUrl: BILLING_URL,
      endsOn: "2026-10-01",
      name: "<script>alert(1)</script>",
      planName: "Pro",
    });

    expect(!message.html.includes("<script>")).toBeTruthy();
  });
});

describe(paymentFailed, () => {
  it("says the plan is still live and when that ends", () => {
    const message = paymentFailed({
      appName: "Acme",
      billingUrl: BILLING_URL,
      lockoutOn: "2026-10-14",
      name: "Ada",
      planName: "Pro",
    });

    expect(message.subject).toMatch(/Acme/);
    expect(message.html).toMatch(/2026-10-14/);
    expect(message.html).toMatch(/stays active/);
  });
});

describe(accountLocked, () => {
  it("names both the plan that stopped and the one now in force", () => {
    const message = accountLocked({
      appName: "Acme",
      billingUrl: BILLING_URL,
      defaultPlanName: "Free",
      name: "Ada",
      planName: "Pro",
    });

    expect(message.html).toMatch(/Pro/);
    expect(message.html).toMatch(/Free/);
    // The reassurance is the load-bearing sentence: a locked account keeps its data.
    expect(message.html).toMatch(/Nothing has been deleted/);
  });
});

describe("every billing template", () => {
  it("refuses a link that is not an absolute https URL", () => {
    // `safeUrl` throws rather than render a link an inbox cannot resolve or should not
    // follow. Checked here because all three templates put a caller's URL in an `href`.
    // oxlint-disable-next-line no-script-url -- the test proves the templates refuse this scheme
    for (const url of ["/billing", "javascript:alert(1)", "http://evil.test"]) {
      expect(() =>
        accountLocked({
          appName: "Acme",
          billingUrl: url,
          defaultPlanName: "Free",
          name: "Ada",
          planName: "Pro",
        })
      ).toThrow(/Unsafe link/);
    }
  });

  it("accepts the localhost default a project starts with", () => {
    expect(() =>
      paymentFailed({
        appName: "Acme",
        billingUrl: "http://localhost:3001/billing",
        lockoutOn: "2026-10-14",
        name: "Ada",
        planName: "Pro",
      })
    ).not.toThrow();
  });
});
