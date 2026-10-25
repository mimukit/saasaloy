// Tests for the local provider. It is the one provider that can be exercised end to
// end in this repo: no account, no binding, no network. It ships as
// `packages/storage/src/providers/memory.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { defineStorage } from "../define";
import { StorageError } from "../provider";
import type { StorageEnv } from "../provider";
import { memory } from "./memory";

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
    expect(memory().name).toBe("memory");
  });

  it("puts, heads and gets, with no network", async () => {
    const files = client();

    const written = await files.put(KEY, "hello", {
      contentType: "text/plain",
    });
    expect(written).toMatchObject({ key: KEY, size: 5 });

    const head = await files.head(KEY);
    expect(head).toMatchObject({ contentType: "text/plain", size: 5 });

    const object = await files.get(KEY);
    await expect(object?.text()).resolves.toBe("hello");
  });

  it("lists what it put", async () => {
    const files = client();
    await files.put(KEY, "hello", { contentType: "text/plain" });

    const listed = await files.list({ prefix: "t/t1/" });
    expect(listed.objects.map((entry) => entry.key)).toStrictEqual([KEY]);
    expect(listed.truncated).toBeFalsy();
  });

  it("deletes what it put", async () => {
    const files = client();
    await files.put(KEY, "hello", { contentType: "text/plain" });

    await files.delete(KEY);
    await expect(files.head(KEY)).resolves.toBeNull();
    await expect(files.get(KEY)).resolves.toBeNull();
  });

  const bodies: [
    string,
    () => Parameters<ReturnType<typeof client>["put"]>[1],
  ][] = [
    ["string", () => "abc"],
    ["arraybuffer", () => new TextEncoder().encode("abc").buffer],
    ["view", () => new TextEncoder().encode("abc")],
    ["blob", () => new Blob(["abc"])],
    [
      "stream",
      () => new Blob(["a", "bc"]).stream() as unknown as ReadableStream,
    ],
  ];

  it.each(bodies)("reads a %s body", async (name, body) => {
    const files = client();
    const key = `t/t1/uploads/${name}/a.txt`;
    await files.put(key, body());
    const object = await files.get(key);
    await expect(object?.text()).resolves.toBe("abc");
  });

  it("serves the same object body twice", async () => {
    const files = client();
    await files.put(KEY, "hello");
    const first = await files.get(KEY);
    await expect(first?.text()).resolves.toBe("hello");
    const second = await files.get(KEY);
    await expect(second?.text()).resolves.toBe("hello");
  });

  it("pages a list and takes its own cursor back", async () => {
    const files = client();
    for (const id of ["i1", "i2", "i3"]) {
      await files.put(`t/t1/uploads/${id}/a.txt`, id);
    }

    const first = await files.list({ limit: 2, prefix: "t/t1/" });
    expect(first.objects).toHaveLength(2);
    expect(first.truncated).toBeTruthy();

    const second = await files.list({
      cursor: first.cursor,
      limit: 2,
      prefix: "t/t1/",
    });
    expect(second.objects).toHaveLength(1);
    expect(second.truncated).toBeFalsy();
    expect(second.objects[0]?.key).toBe("t/t1/uploads/i3/a.txt");
  });

  it("keeps one tenant's prefix out of another's list", async () => {
    const files = client();
    await files.put("t/t1/uploads/i1/a.txt", "one");
    await files.put("t/t2/uploads/i1/a.txt", "two");

    const listed = await files.list({ prefix: "t/t1/" });
    expect(listed.objects.map((entry) => entry.key)).toStrictEqual([
      "t/t1/uploads/i1/a.txt",
    ]);
  });

  it("deletes an absent key without complaining", async () => {
    await expect(client().delete(KEY)).resolves.toBeUndefined();
  });

  it("falls back to the proxy target, because it signs nothing", async () => {
    const provider = memory();
    expect(provider.presignPut).toBeUndefined();
    expect(provider.presignGet).toBeUndefined();

    const target = await client().createUploadUrl(KEY, {
      contentType: "text/plain",
    });
    expect(target.direct).toBeFalsy();
    expect(target.method).toBe("PUT");
    expect(target.url).toMatch(/^\/storage\/objects\?token=/);
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
    expect(parts.map((part) => part.partNumber)).toStrictEqual([1, 2, 3]);

    const completed = await files.completeMultipart(upload, parts);
    expect(completed.size).toBe("one,two,three".length);

    const object = await files.get(KEY);
    await expect(object?.text()).resolves.toBe("one,two,three");
    expect(object?.contentType).toBe("text/csv");
  });

  it("assembles in the order the caller lists, not the order parts arrived", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);

    const second = await files.uploadPart(upload, 2, "second");
    const first = await files.uploadPart(upload, 1, "first-");

    await files.completeMultipart(upload, [first, second]);
    const object = await files.get(KEY);
    await expect(object?.text()).resolves.toBe("first-second");
  });

  it("refuses to complete an upload it never started", async () => {
    await expect(() =>
      client().completeMultipart({ key: KEY, uploadId: "nope" }, [])
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "not_found"
      )
    );
  });

  it("drops the parts on abort, so a later complete finds nothing", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);
    await files.uploadPart(upload, 1, "one");
    await files.abortMultipart(upload);

    await expect(() => files.completeMultipart(upload, [])).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "not_found"
      )
    );
    await expect(files.head(KEY)).resolves.toBeNull();
  });

  it("refuses a part number below 1", async () => {
    const files = client();
    const upload = await files.createMultipartUpload(KEY);
    await expect(() => files.uploadPart(upload, 0, "one")).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "provider_error"
      )
    );
  });
});
