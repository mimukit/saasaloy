// Tests for the `db:seed` guard in ./seed.ts. It ships as `seed.test.ts` when testing is
// on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { refuseTarget } from "./seed";

describe(refuseTarget, () => {
  it("lets a plain run through", () => {
    expect(() => refuseTarget([], {})).not.toThrow();
  });

  it("refuses --remote", () => {
    expect(() => refuseTarget(["--remote"], {})).toThrow(/remote D1/);
  });

  it("refuses --remote wherever it sits", () => {
    expect(() => refuseTarget(["--local", "--remote"], {})).toThrow(
      /remote D1/
    );
  });

  it("refuses any other flag", () => {
    expect(() => refuseTarget(["--force"], {})).toThrow(/Unknown flag --force/);
  });

  it("refuses NODE_ENV=production before reading a flag", () => {
    expect(() => refuseTarget([], { NODE_ENV: "production" })).toThrow(
      /production/
    );
  });
});
