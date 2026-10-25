// Holds two modules to one phone number shape. `validators` normalizes a Bangladeshi mobile
// number to E.164, and `sms-khudebarta` refuses any recipient that does not match its own
// `BANGLADESH_NUMBER` regex. `validators`' unit test ships into a project, where the
// provider file may not exist, so it carries a copy of the regex. This guard reads the
// provider's regex from its source and checks the copy and the schema against it. Run it
// with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { bangladeshMobile } from "../modules/validators/files/src/phone.ts";

const read = (path: string) =>
  readFileSync(new URL(`../modules/${path}`, import.meta.url), "utf-8");

const declared = /const BANGLADESH_NUMBER = \/(.+)\/;/.exec(
  read("sms-khudebarta/files/khudebarta.ts")
)?.[1];

describe("the provider's phone regex", () => {
  it("is declared where this guard reads it", () => {
    assert.ok(declared, "khudebarta.ts no longer declares BANGLADESH_NUMBER");
  });

  it("is the copy the validators test carries", () => {
    assert.ok(
      read("validators/files/src/phone.vitest.ts").includes(
        `const PROVIDER_NUMBER = /${declared}/;`
      ),
      "khudebarta.ts changed BANGLADESH_NUMBER; update PROVIDER_NUMBER in phone.vitest.ts"
    );
  });

  it("accepts what bangladeshMobile returns for every operator digit", () => {
    const provider = new RegExp(declared ?? "^$");
    for (const digit of ["3", "4", "5", "6", "7", "8", "9"]) {
      assert.match(bangladeshMobile.parse(`+880 1${digit}12-345678`), provider);
    }
  });
});
