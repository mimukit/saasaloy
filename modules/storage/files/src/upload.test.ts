// Tests for the Worker-path upload checks. The cap, the signature and the key ownership
// are what stop a caller storing a 2 GB body, an HTML page named receipt.png, or a key
// from someone else's record. This file is repo-only — it is not in the descriptor's
// scaffold list — and runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKey } from "./keys.ts";
import { StorageError } from "./provider.ts";
import { ownsKey, readLimited, sniffType } from "./upload.ts";

/** A body with no Content-Length: the chunks arrive one by one. */
function chunked(...chunks: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of chunks) {
        controller.enqueue(new Uint8Array(size).fill(7));
      }
      controller.close();
    },
  });
}

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = text("RIFF\0\0\0\0WEBPVP8 ");
const GIF = text("GIF89a\u0001\0");
const PDF = text("%PDF-1.7\n");

describe("readLimited", () => {
  it("returns every byte at or under the cap", async () => {
    const result = await readLimited(chunked(3, 4, 3), 10);
    assert.equal(result?.byteLength, 10);
    assert.ok(result?.every((value) => value === 7));
  });

  it("returns null past the cap, with no Content-Length to go on", async () => {
    assert.equal(await readLimited(chunked(4, 4, 4), 10), null);
  });

  it("cancels the stream at the cap instead of reading the rest", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4));
      },
    });
    assert.equal(await readLimited(endless, 10), null);
    assert.ok(pulled < 10, `pulled ${pulled} chunks`);
  });

  it("reads a missing body as zero bytes", async () => {
    assert.equal((await readLimited(null, 10))?.byteLength, 0);
  });

  it("throws on a cap that is not a positive whole number", async () => {
    for (const cap of [Number.NaN, 0, -1, 1.5]) {
      await assert.rejects(readLimited(chunked(1), cap), RangeError);
    }
  });
});

describe("sniffType", () => {
  const all = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ] as const;

  it("names each signature it knows", () => {
    assert.deepEqual(sniffType(JPEG, all), {
      type: "image/jpeg",
      extension: "jpg",
    });
    assert.deepEqual(sniffType(PNG, all), {
      type: "image/png",
      extension: "png",
    });
    assert.deepEqual(sniffType(WEBP, all), {
      type: "image/webp",
      extension: "webp",
    });
    assert.deepEqual(sniffType(GIF, all), {
      type: "image/gif",
      extension: "gif",
    });
    assert.deepEqual(sniffType(PDF, all), {
      type: "application/pdf",
      extension: "pdf",
    });
  });

  it("refuses a PNG renamed .pdf when only PDF is allowed", () => {
    assert.equal(sniffType(PNG, ["application/pdf"]), null);
  });

  it("refuses bytes with no known signature", () => {
    assert.equal(sniffType(text("<html><body>"), all), null);
    assert.equal(sniffType(new Uint8Array(), all), null);
  });
});

describe("ownsKey", () => {
  const parts = { tenantId: "u1", scope: "payment-receipts", id: "p1" };
  const own = buildKey({
    ...parts,
    filename: "0f8fad5b-d9cb-469f-a165-70867728950e.png",
  });

  it("accepts a key under the caller's own prefix", () => {
    assert.equal(ownsKey(own, parts), true);
  });

  it("refuses another tenant, another scope and another record", () => {
    assert.equal(ownsKey(own, { ...parts, tenantId: "u2" }), false);
    assert.equal(ownsKey(own, { ...parts, scope: "support" }), false);
    assert.equal(ownsKey(own, { ...parts, id: "p2" }), false);
  });

  it("refuses a key that only shares a prefix with the record id", () => {
    const longer = buildKey({ ...parts, id: "p10", filename: "a.png" });
    assert.equal(ownsKey(longer, parts), false);
  });

  it("refuses a key with a traversal in it", () => {
    assert.equal(
      ownsKey("t/u1/payment-receipts/p1/../../u2/x.png", parts),
      false
    );
    assert.equal(ownsKey("t/u1/payment-receipts/p1/..", parts), false);
  });

  it("applies the filename pattern when one is given", () => {
    const uuidImage = /^[a-f\d-]{36}\.(jpg|png|webp)$/;
    assert.equal(ownsKey(own, parts, { filename: uuidImage }), true);
    const named = buildKey({ ...parts, filename: "my-receipt.png" });
    assert.equal(ownsKey(named, parts, { filename: uuidImage }), false);
  });

  it("throws when the route passes parts that are not key segments", () => {
    assert.throws(
      () => ownsKey(own, { ...parts, tenantId: "../u2" }),
      (error) => error instanceof StorageError && error.code === "invalid_key"
    );
  });
});
