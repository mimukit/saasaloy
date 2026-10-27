// Tests for the in-process provider: TTL expiry, the `list` cursor over 2,500 keys, and
// the fixed-window counter behind `consume`. It ships as `memory.test.ts` beside the
// provider when testing is on, and `pnpm test:modules` runs it in place in the saasaloy
// repo.
//
// Nothing here is stubbed. `../index` and `../provider` resolve by their project paths to
// the real `packages/kv` core, so the assertions below go through the same key building,
// JSON encoding, size cap and TTL floor a deployed Worker uses.

import { afterEach, describe, expect, it } from "vitest";
import { memory } from "./memory";
import { defineKv, definePolicy } from "../index";
import { KvError } from "../provider";
import type { KvClient } from "../index";

/** Wait `ms` milliseconds. The global timer, so the workspace needs no Node types. */
function sleep(ms: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- wrapping the global timer is the point; there is no Node `timers/promises` type here
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const ENV = { KV_PROVIDER: "memory" };

const STRICT = definePolicy({ limit: 3, name: "strict", periodSeconds: 60 });

const provider = memory();

/** A client over the one shared provider instance, so `reset()` clears what a test wrote. */
function client(): KvClient {
  return defineKv({ policies: [STRICT], providers: [provider] }).create(ENV);
}

describe("kv-memory", () => {
  afterEach(() => {
    provider.reset();
  });

  describe("memory kv provider", () => {
    it("selects on KV_PROVIDER and round-trips a value through the core", async () => {
      const store = client();
      expect(store.provider).toBe("memory");

      const key = store.key({ namespace: "widget", parts: ["w_1"] });
      expect(key).toBe("widget:w_1");

      await expect(store.get(key)).resolves.toBeNull();
      await store.set(key, { count: 2, name: "hello" });
      await expect(store.get(key)).resolves.toStrictEqual({
        count: 2,
        name: "hello",
      });

      await store.delete(key);
      await expect(store.get(key)).resolves.toBeNull();
    });

    it("accepts a one-second TTL, because its floor is zero", async () => {
      const store = client();
      const key = "ttl:short";

      await store.set(key, "here", { ttlSeconds: 1 });
      await expect(store.get(key)).resolves.toBe("here");

      await sleep(1100);
      await expect(store.get(key)).resolves.toBeNull();
      // The expired entry is dropped on the way past, not left to leak.
      expect(provider.size()).toBe(0);
    });

    it("keeps a value with no TTL", async () => {
      const store = client();
      await store.set("ttl:none", "kept");
      await sleep(20);
      await expect(store.get("ttl:none")).resolves.toBe("kept");
    });

    it("pages 2,500 keys with the cursor it issued", async () => {
      const store = client();
      const total = 2500;

      for (let index = 0; index < total; index += 1) {
        // Zero-padded, so lexicographic order is numeric order and a missed key shows up
        // as a gap rather than as a reshuffle.
        await store.set(`page:${String(index).padStart(4, "0")}`, index);
      }

      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      let complete = false;

      do {
        const result = await store.list({
          prefix: "page:",
          ...(cursor === undefined ? {} : { cursor }),
        });
        pages += 1;
        for (const key of result.keys) {
          expect(seen.has(key), `duplicate key ${key}`).toBeFalsy();
          seen.add(key);
        }
        ({ complete, cursor } = result);
        expect(complete).toBe(cursor === undefined);
        expect(pages <= 10, "the cursor is not advancing").toBeTruthy();
      } while (!complete);

      expect(seen.size).toBe(total);
      // 1,000 per page, KV's own default: three pages for 2,500 keys.
      expect(pages).toBe(3);
      expect(seen.has("page:0000")).toBeTruthy();
      expect(seen.has("page:2499")).toBeTruthy();
    });

    it("honours prefix and limit, and skips expired keys", async () => {
      const store = client();
      await store.set("a:1", 1);
      await store.set("a:2", 2);
      await store.set("b:1", 3);
      await store.set("a:3", 4, { ttlSeconds: 1 });

      const first = await store.list({ limit: 2, prefix: "a:" });
      expect(first.keys).toStrictEqual(["a:1", "a:2"]);
      expect(first.complete).toBeFalsy();

      const second = await store.list({
        limit: 2,
        prefix: "a:",
        // Non-null: the page above was incomplete.
        cursor: first.cursor as string,
      });
      expect(second.keys).toStrictEqual(["a:3"]);
      expect(second.complete).toBeTruthy();

      await sleep(1100);
      const third = await store.list({ prefix: "a:" });
      expect(third.keys).toStrictEqual(["a:1", "a:2"]);
    });

    it("refuses a cursor it did not issue", async () => {
      const store = client();
      await expect(() =>
        store.list({ cursor: "not base64 ***" })
      ).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("not_supported");
          return true;
        })
      );
    });

    it("reports remaining and resetAt on the first consume of a window", async () => {
      const store = client();
      const before = Date.now();

      const first = await store.consume({ key: "1.2.3.4", policy: "strict" });
      expect(first.success).toBeTruthy();
      expect(first.remaining).toBe(2);
      expect((first.resetAt ?? 0) > before).toBeTruthy();
    });

    it("counts a fixed window in consume down to a refusal", async () => {
      const store = client();
      await store.consume({ key: "1.2.3.4", policy: "strict" });

      const second = await store.consume({ key: "1.2.3.4", policy: "strict" });
      expect(second.remaining).toBe(1);
      const third = await store.consume({ key: "1.2.3.4", policy: "strict" });
      expect(third.remaining).toBe(0);

      const fourth = await store.consume({ key: "1.2.3.4", policy: "strict" });
      // A refusal is a value, never a throw.
      expect(fourth.success).toBeFalsy();
      expect(fourth.remaining).toBe(0);
    });

    it("gives each key its own budget", async () => {
      const store = client();
      for (let index = 0; index < 3; index += 1) {
        await store.consume({ key: "1.2.3.4", policy: "strict" });
      }
      const spent = await store.consume({ key: "1.2.3.4", policy: "strict" });
      expect(spent.success).toBeFalsy();
      const fresh = await store.consume({ key: "5.6.7.8", policy: "strict" });
      expect(fresh.success).toBeTruthy();
    });

    it("leaves the policy lookup to the core", async () => {
      const store = client();
      await expect(() =>
        store.consume({ key: "k", policy: "nope" })
      ).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("not_supported");
          return true;
        })
      );
    });

    it("still enforces the core's key and TTL rules", async () => {
      const store = client();
      await expect(() => store.set("", "x")).rejects.toThrow(KvError);
      await expect(() =>
        store.set("k", "x", { ttlSeconds: 0 })
      ).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("invalid_ttl");
          return true;
        })
      );
    });
  });

  // The provider is the one file this module ships into a consumer's repo. A raw control
  // byte in it makes git call the file binary, so `git diff`, `git blame -L` and a merge
  // on it stop working for every project that ran `saasaloy add kv-memory`.
  describe("the shipped source", () => {
    it("holds no raw control bytes", async () => {
      // A computed specifier, typed by hand: the kv workspace carries no Node types, and
      // this one test is the only thing in it that reads a file.
      const fs = (await import("node:fs/promises" as string)) as {
        readFile(path: URL, encoding: "utf-8"): Promise<string>;
      };
      const source = await fs.readFile(
        new URL("memory.ts", import.meta.url),
        "utf-8"
      );
      // oxlint-disable-next-line no-control-regex -- reading for them is the point here
      const offending = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.exec(
        source
      );

      expect(
        offending,
        `memory.ts holds a raw control byte at index ${String(offending?.index)}`
      ).toBeNull();
    });
  });
});
