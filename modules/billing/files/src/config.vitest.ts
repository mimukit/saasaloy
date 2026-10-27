// Tests for the one number the capability reads out of the environment. It ships as
// `config.test.ts` when testing is on, and `pnpm test:modules` runs it in place on Vitest
// in the saasaloy repo.

import { describe, expect, it } from "vitest";
import {
  billingConfig,
  DEFAULT_LOCKOUT_DAYS,
  readLockoutDays,
  setBillingConfig,
} from "./config";

describe(readLockoutDays, () => {
  it("takes a positive integer as written", () => {
    expect(readLockoutDays("30")).toBe(30);
  });

  it("floors a fractional one rather than locking half a day early", () => {
    expect(readLockoutDays("7.9")).toBe(7);
  });

  it("falls back to 14 for unset, empty, non-numeric and non-positive values", () => {
    // The var is documented optional, and a typo that locked every past-due subject on the
    // first tick is worse than one the sweep ignores.
    for (const raw of [undefined, "", " ", "soon", "-1", "0", "0.5", "NaN"]) {
      expect(readLockoutDays(raw)).toBe(DEFAULT_LOCKOUT_DAYS);
    }
  });
});

describe(billingConfig, () => {
  it("answers the default before anything registers a config", () => {
    expect(billingConfig().lockoutDays).toBe(DEFAULT_LOCKOUT_DAYS);
  });

  it("answers what was registered, and keeps the rest", () => {
    setBillingConfig({ lockoutDays: 21 });

    expect(billingConfig().lockoutDays).toBe(21);

    setBillingConfig({});
    expect(billingConfig().lockoutDays).toBe(21);
    setBillingConfig({ lockoutDays: DEFAULT_LOCKOUT_DAYS });
  });
});
