// Tests for the `db:seed` guard in ./seed.ts. Repo-only: the descriptor does not ship this
// file. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refuseTarget } from "./seed.ts";

describe("refuseTarget", () => {
  it("lets a plain run through", () => {
    refuseTarget([], {});
  });

  it("refuses --remote", () => {
    assert.throws(() => refuseTarget(["--remote"], {}), /remote D1/);
  });

  it("refuses --remote wherever it sits", () => {
    assert.throws(() => refuseTarget(["--local", "--remote"], {}), /remote D1/);
  });

  it("refuses any other flag", () => {
    assert.throws(() => refuseTarget(["--force"], {}), /Unknown flag --force/);
  });

  it("refuses NODE_ENV=production before reading a flag", () => {
    assert.throws(
      () => refuseTarget([], { NODE_ENV: "production" }),
      /production/
    );
  });
});
