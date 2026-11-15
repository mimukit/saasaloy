// Tests for the cms request bodies and queries. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cmsCollectionParam,
  cmsDraftInput,
  cmsEntryInput,
  cmsListQuery,
  cmsPublicListQuery,
  cmsVersionInput,
} from "./cms.ts";

const DOC = { body: { type: "doc" } };

describe("cmsEntryInput", () => {
  it("accepts a title, a slug and a data object", () => {
    assert.equal(
      cmsEntryInput.safeParse({ title: "Hello", slug: "hello", data: DOC })
        .success,
      true
    );
  });

  it("refuses a blank title, a bad slug and a non-object data", () => {
    for (const body of [
      { title: " ", slug: "hello", data: DOC },
      { title: "Hello", slug: "Hello World", data: DOC },
      { title: "Hello", slug: "hello", data: [] },
      { title: "Hello", slug: "hello", data: "x" },
    ]) {
      assert.equal(
        cmsEntryInput.safeParse(body).success,
        false,
        JSON.stringify(body)
      );
    }
  });
});

describe("cmsDraftInput", () => {
  it("needs the version the edit started from", () => {
    const body = { title: "Hello", slug: "hello", data: DOC };
    assert.equal(cmsDraftInput.safeParse(body).success, false);
    assert.equal(
      cmsDraftInput.safeParse({ ...body, version: 3 }).success,
      true
    );
    assert.equal(
      cmsDraftInput.safeParse({ ...body, version: 0 }).success,
      false
    );
  });
});

describe("cmsVersionInput", () => {
  it("accepts a positive whole version", () => {
    assert.equal(cmsVersionInput.safeParse({ version: 1 }).success, true);
    assert.equal(cmsVersionInput.safeParse({ version: 1.5 }).success, false);
  });
});

describe("cmsListQuery", () => {
  it("defaults to page 1 and the current filter", () => {
    assert.deepEqual(cmsListQuery.parse({}), { page: 1, status: "current" });
  });

  it("reads the page from a query string and checks the filter", () => {
    assert.deepEqual(cmsListQuery.parse({ page: "2", status: "archived" }), {
      page: 2,
      status: "archived",
    });
    assert.equal(cmsListQuery.safeParse({ status: "deleted" }).success, false);
    assert.equal(cmsListQuery.safeParse({ page: "0" }).success, false);
  });
});

describe("cmsPublicListQuery", () => {
  it("defaults to page 1", () => {
    assert.deepEqual(cmsPublicListQuery.parse({}), { page: 1 });
  });
});

describe("cmsCollectionParam", () => {
  it("accepts a lower-case kebab name", () => {
    assert.equal(
      cmsCollectionParam.safeParse({ collection: "blog" }).success,
      true
    );
    assert.equal(
      cmsCollectionParam.safeParse({ collection: "Blog" }).success,
      false
    );
  });
});
