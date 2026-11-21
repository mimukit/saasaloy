import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTAINER_SERVER,
  argumentError,
  databaseServer,
  placeWaitlistForm,
  withDatabaseUrl,
} from "./verify-e2e.ts";

describe("argumentError", () => {
  it("takes no argument", () => {
    assert.equal(argumentError([]), undefined);
  });

  it("names an argument it does not take", () => {
    assert.equal(
      argumentError(["--drvier=postgres"]),
      "unknown argument(s) --drvier=postgres. This command takes none."
    );
  });
});

describe("placeWaitlistForm", () => {
  const page = [
    "---",
    'import Layout from "../layouts/Layout.astro";',
    "---",
    "  <main>",
    "    <Cta siteName={siteName} />",
    "  </main>",
  ].join("\n");

  it("adds the import and the island after the Cta", () => {
    const placed = placeWaitlistForm(page) ?? "";
    assert.match(
      placed,
      /import WaitlistForm from "@web\/components\/WaitlistForm";\nimport Layout/
    );
    assert.match(
      placed,
      /<Cta siteName=\{siteName\} \/>\n {4}<WaitlistForm client:load \/>/
    );
  });

  it("leaves a page that already holds the form alone", () => {
    const placed = placeWaitlistForm(page) ?? "";
    assert.equal(placeWaitlistForm(placed), placed);
  });

  it("returns undefined when an anchor is gone", () => {
    assert.equal(placeWaitlistForm(page.replace("<Cta", "<Footer")), undefined);
  });
});

describe("withDatabaseUrl", () => {
  it("replaces the line that is there", () => {
    assert.equal(
      withDatabaseUrl(
        "A=1\nDATABASE_URL=postgres://old/app\nB=2\n",
        "postgres://new/postgres"
      ),
      "A=1\nDATABASE_URL=postgres://new/postgres\nB=2\n"
    );
  });

  it("appends the key when the file has none", () => {
    assert.equal(
      withDatabaseUrl("A=1", "postgres://new/postgres"),
      "A=1\nDATABASE_URL=postgres://new/postgres\n"
    );
  });
});

describe("databaseServer", () => {
  it("falls back to the project's container when unset or empty", () => {
    assert.equal(databaseServer(), CONTAINER_SERVER);
    assert.equal(databaseServer(""), CONTAINER_SERVER);
  });

  it("takes the server the environment names", () => {
    assert.equal(
      databaseServer("postgres://ci/postgres"),
      "postgres://ci/postgres"
    );
  });
});
