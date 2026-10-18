// Tests for the pure parts of `scripts/verify-a11y.ts`. The browser run itself needs a built
// playground and Chromium, so it is a by-hand and nightly job. Three decisions inside it
// are cheap to pin here: how a request path maps onto the built site, which islands count
// as a budget breach, and which metadata a page must carry.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  islandFindings,
  metaFindings,
  REQUIRED_META,
  resolveRequest,
} from "./verify-a11y.ts";

describe("resolveRequest", () => {
  let site = "";

  before(async () => {
    site = await mkdtemp(join(tmpdir(), "verify-a11y-"));
    await mkdir(join(site, "terms"));
    await writeFile(join(site, "index.html"), "home");
    await writeFile(join(site, "terms/index.html"), "terms");
    await writeFile(join(site, "privacy.html"), "privacy");
    await writeFile(join(site, "404.html"), "missing");
  });

  after(async () => {
    await rm(site, { recursive: true, force: true });
  });

  it("serves index.html for the root", async () => {
    assert.deepEqual(await resolveRequest(site, "/"), {
      file: join(site, "index.html"),
      status: 200,
    });
  });

  it("serves a directory index for a clean URL", async () => {
    assert.deepEqual(await resolveRequest(site, "/terms"), {
      file: join(site, "terms/index.html"),
      status: 200,
    });
  });

  it("serves a .html file for a clean URL", async () => {
    assert.deepEqual(await resolveRequest(site, "/privacy?x=1"), {
      file: join(site, "privacy.html"),
      status: 200,
    });
  });

  it("serves 404.html with status 404 for a miss", async () => {
    assert.deepEqual(await resolveRequest(site, "/nope"), {
      file: join(site, "404.html"),
      status: 404,
    });
  });
});

describe("islandFindings", () => {
  it("passes the two allowed islands", () => {
    assert.deepEqual(islandFindings(["Navbar", "PricingTable"]), []);
  });

  it("flags an island the plan does not allow", () => {
    const findings = islandFindings(["Navbar", "PricingTable", "Faq"]);
    assert.equal(findings.length, 1);
    assert.match(findings[0]?.detail ?? "", /^Faq hydrates/u);
  });

  it("flags an allowed island that stopped hydrating", () => {
    const findings = islandFindings(["Navbar"]);
    assert.equal(findings.length, 1);
    assert.match(findings[0]?.detail ?? "", /^PricingTable no longer/u);
  });
});

describe("metaFindings", () => {
  it("passes a page with every required tag", () => {
    const present = Object.fromEntries(REQUIRED_META.map((s) => [s, true]));
    assert.deepEqual(metaFindings(present), []);
  });

  it("names each missing tag", () => {
    const findings = metaFindings({ 'link[rel="canonical"]': true });
    assert.deepEqual(
      findings.map((finding) => finding.detail),
      REQUIRED_META.filter((s) => s !== 'link[rel="canonical"]').map(
        (s) => `missing ${s}`
      )
    );
  });
});
