// Tests for the local provider. It is the one provider that can be exercised end to
// end in this repo: no account, no binding, no network. This file is NOT in the
// descriptor's `files[]`, so `saasaloy add storage-memory` never copies it into a
// project. Run it with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineStorage } from "../../storage/files/src/define.ts";
import { StorageError } from "../../storage/files/src/provider.ts";
import type { StorageEnv } from "../../storage/files/src/provider.ts";
import { memory } from "./memory.ts";

const KEY = "t/t1/uploads/i1/notes.txt";

const env: StorageEnv = {
  STORAGE_PROVIDER: "memory",
  STORAGE_URL_SECRET: "test-secret-value-not-a-real-key",
};

function client() {
  return defineStorage({ providers: [memory()] }).create(env);
}

describe("memory provider", () => {
  it("names itself `memory`, the value STORAGE_PROVIDER must hold", () => {
    assert.equal(memory().name, "memory");
  });

  it("puts, heads, gets, lists and deletes, with no network", async () => {
    const files = client();

    const written = await files.put(KEY, "hello", {
      contentType: "text/plain",
    });
    assert.equal(written.key, KEY);
    assert.equal(written.size, 5);

    const head = await files.head(KEY);
    assert.equal(head?.size, 5);
    assert.equal(head?.contentType, "text/plain");

    const object = await files.get(KEY);
    assert.equal(await object?.text(), "hello");

    const listed = await files.list({ prefix: "t/t1/" });
    assert.deepEqual(
      listed.objects.map((entry) => entry.key),
      [KEY]
    );
    assert.equal(listed.truncated, false);

    await files.delete(KEY);
    assert.equal(await files.head(KEY), null);
    assert.equal(await files.get(KEY), null);
  });

  it("reads every body shape the contract admits", async () => {
    const files = client();
    const bodies: [string, Parameters<typeof files.put>[1]][] = [
      ["string", "abc"],
      ["arraybuffer", new TextEncoder().encode("abc").buffer],
      ["view", new TextEncoder().encode("abc")],
      ["blob", new Blob(["abc"])],
      ["stream", new Blob(["a", "bc"]).stream() as unknown as ReadableStream],
    ];

    for (const [name, body] of bodies) {
      const key = `t/t1/uploads/${name}/a.txt`;
      await files.put(key, body);
      const object = await files.get(key);
      assert.equal(await object?.text(), "abc", name);
    }
  });

  it("serves the same object body twice", async () => {
    const files = client();
    await files.put(KEY, "hello");
    assert.equal(await (await files.get(KEY))?.text(), "hello");
    assert.equal(await (await files.get(KEY))?.text(), "hello");
  });

  it("pages a list and takes its own cursor back", async () => {
    const files = client();
    for (const id of ["i1", "i2", "i3"]) {
      await files.put(`t/t1/uploads/${id}/a.txt`, id);
    }

    const first = await files.list({ limit: 2, prefix: "t/t1/" });
    assert.equal(first.objects.length, 2);
    assert.equal(first.truncated, true);

    const second = await files.list({
      cursor: first.cursor,
      limit: 2,
      prefix: "t/t1/",
    });
    assert.equal(second.objects.length, 1);
    assert.equal(second.truncated, false);
    assert.equal(second.objects[0]?.key, "t/t1/uploads/i3/a.txt");
  });

  it("keeps one tenant's prefix out of another's list", async () => {
    const files = client();
    await files.put("t/t1/uploads/i1/a.txt", "one");
    await files.put("t/t2/uploads/i1/a.txt", "two");

    const listed = await files.list({ prefix: "t/t1/" });
    assert.deepEqual(
      listed.objects.map((entry) => entry.key),
      ["t/t1/uploads/i1/a.txt"]
    );
  });

  it("deletes an absent key without complaining", async () => {
    await assert.doesNotReject(() => client().delete(KEY));
  });

  it("falls back to the proxy target, because it signs nothing", async () => {
    const provider = memory();
    assert.equal(provider.presignPut, undefined);
    assert.equal(provider.presignGet, undefined);

    const target = await client().createUploadUrl(KEY, {
      contentType: "text/plain",
    });
    assert.equal(target.direct, false);
    assert.equal(target.method, "PUT");
    assert.match(target.url, /^\/storage\/objects\?token=/);
  });
});

describe("memory multipart", () => {
  it("completes three parts as the concatenated bytes", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY, {
      contentType: "text/csv",
    });

    const parts = [];
    for (const [index, chunk] of ["one,", "two,", "three"].entries()) {
      parts.push(await files.uploadPart(upload, index + 1, chunk));
    }
    assert.deepEqual(
      parts.map((part) => part.partNumber),
      [1, 2, 3]
    );

    const completed = await files.completeMultipart(upload, parts);
    assert.equal(completed.size, "one,two,three".length);

    const object = await files.get(KEY);
    assert.equal(await object?.text(), "one,two,three");
    assert.equal(object?.contentType, "text/csv");
  });

  it("assembles in the order the caller lists, not the order parts arrived", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);

    const second = await files.uploadPart(upload, 2, "second");
    const first = await files.uploadPart(upload, 1, "first-");

    await files.completeMultipart(upload, [first, second]);
    assert.equal(await (await files.get(KEY))?.text(), "first-second");
  });

  it("refuses to complete an upload it never started", async () => {
    await assert.rejects(
      () => client().completeMultipart({ key: KEY, uploadId: "nope" }, []),
      (error: unknown) =>
        error instanceof StorageError && error.code === "not_found"
    );
  });

  it("drops the parts on abort, so a later complete finds nothing", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);
    await files.uploadPart(upload, 1, "one");
    await files.abortMultipart(upload);

    await assert.rejects(
      () => files.completeMultipart(upload, []),
      (error: unknown) =>
        error instanceof StorageError && error.code === "not_found"
    );
    assert.equal(await files.head(KEY), null);
  });

  it("refuses a part number below 1", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);
    await assert.rejects(
      () => files.uploadPart(upload, 0, "one"),
      (error: unknown) =>
        error instanceof StorageError && error.code === "provider_error"
    );
  });
});
