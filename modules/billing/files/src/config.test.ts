// Tests for the one number the capability reads out of the environment. Repo-only, and it
// runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingConfig,
  billingProviderEnv,
  DEFAULT_LOCKOUT_DAYS,
  readLockoutDays,
  setBillingConfig,
  setBillingProviderEnv,
} from "./config.ts";

describe("readLockoutDays", () => {
  it("takes a positive integer as written", () => {
    assert.equal(readLockoutDays("30"), 30);
  });

  it("floors a fractional one rather than locking half a day early", () => {
    assert.equal(readLockoutDays("7.9"), 7);
  });

  it("falls back to 14 for unset, empty, non-numeric and non-positive values", () => {
    // The var is documented optional, and a typo that locked every past-due subject on the
    // first tick is worse than one the sweep ignores.
    for (const raw of [undefined, "", " ", "soon", "-1", "0", "0.5", "NaN"]) {
      assert.equal(readLockoutDays(raw), DEFAULT_LOCKOUT_DAYS);
    }
  });
});

describe("billingConfig", () => {
  it("answers the default before anything registers a config", () => {
    assert.equal(billingConfig().lockoutDays, DEFAULT_LOCKOUT_DAYS);
  });

  it("answers what was registered, and keeps the rest", () => {
    setBillingConfig({ lockoutDays: 21 });

    assert.equal(billingConfig().lockoutDays, 21);

    setBillingConfig({});
    assert.equal(billingConfig().lockoutDays, 21);
    setBillingConfig({ lockoutDays: DEFAULT_LOCKOUT_DAYS });
  });
});

describe("billingProviderEnv", () => {
  // Order matters here, and only here: the reader's "nothing registered yet" branch can only
  // be seen before the first `setBillingProviderEnv` call in this file. Keep this case first.
  it("throws before anything registers an environment", () => {
    assert.throws(
      () => billingProviderEnv(),
      /No billing provider environment is registered/
    );
  });

  it("answers the registered environment, and a second call replaces it", () => {
    setBillingProviderEnv({ BKASH_MERCHANT_APP_KEY: "key_1" });
    assert.equal(billingProviderEnv().BKASH_MERCHANT_APP_KEY, "key_1");

    // Replaces rather than merges. A partial second registration that kept the first one's
    // keys would let a test leak a secret into the run after it.
    setBillingProviderEnv({ KV_PROVIDER: "memory" });
    assert.equal(billingProviderEnv().BKASH_MERCHANT_APP_KEY, undefined);
    assert.equal(billingProviderEnv().KV_PROVIDER, "memory");
  });
});
