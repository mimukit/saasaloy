// Tests for the one number the capability reads out of the environment. Repo-only, and it
// runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  subscriptionConfig,
  DEFAULT_LOCKOUT_DAYS,
  readLockoutDays,
  setSubscriptionConfig,
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

describe("subscriptionConfig", () => {
  it("answers the default before anything registers a config", () => {
    assert.equal(subscriptionConfig().lockoutDays, DEFAULT_LOCKOUT_DAYS);
  });

  it("answers what was registered, and keeps the rest", () => {
    setSubscriptionConfig({ lockoutDays: 21 });

    assert.equal(subscriptionConfig().lockoutDays, 21);

    setSubscriptionConfig({});
    assert.equal(subscriptionConfig().lockoutDays, 21);
    setSubscriptionConfig({ lockoutDays: DEFAULT_LOCKOUT_DAYS });
  });
});
