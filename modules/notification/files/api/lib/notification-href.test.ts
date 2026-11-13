// Tests for ./notification-href.ts. This file is NOT in the descriptor's `files` list, so
// `add notification` never copies it into a user's project; it exists for this repo only,
// the same way `modules/shell/files/ui/lib/shell/nav-counts.test.ts` does. The project gets
// the same rule checked through `notify` in `./notify.vitest.ts`.
//
// It runs on `node:test`, because the file it checks imports nothing. Run it with
// `pnpm test:modules`. The import carries the `.ts` extension because Node's type
// stripping resolves the real file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppPath } from "./notification-href.ts";

describe("isAppPath", () => {
  it("accepts an app-relative path, with a query and a hash", () => {
    assert.equal(isAppPath("/"), true);
    assert.equal(isAppPath("/settings/billing"), true);
    assert.equal(isAppPath("/files?tab=shared#top"), true);
  });

  it("refuses a full URL", () => {
    assert.equal(isAppPath("https://evil.example/"), false);
    assert.equal(isAppPath("javascript:alert(1)"), false);
  });

  it("refuses a protocol-relative URL", () => {
    assert.equal(isAppPath("//evil.example/"), false);
  });

  it("refuses a backslash a browser may read as a slash", () => {
    assert.equal(isAppPath("/\\evil.example/"), false);
  });

  it("refuses a relative path and an empty string", () => {
    assert.equal(isAppPath("settings"), false);
    assert.equal(isAppPath(""), false);
  });
});
