// Tests for percentage bucketing. Repo-only: the descriptor ships `hash.ts`, never this
// file. No stubs and no hooks — the module imports nothing.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucket, fnv1a32 } from "./hash.ts";

describe("fnv1a32", () => {
  it("stays a 32-bit unsigned integer for a long input", () => {
    const hash = fnv1a32("a".repeat(10_000));
    assert.ok(Number.isInteger(hash));
    assert.ok(hash >= 0 && hash <= 0xff_ff_ff_ff);
  });

  it("gives the empty string the offset basis", () => {
    assert.equal(fnv1a32(""), 0x81_1c_9d_c5);
  });

  it("changes when one character changes", () => {
    assert.notEqual(fnv1a32("user-1"), fnv1a32("user-2"));
  });
});

describe("bucket", () => {
  it("is stable for a subject across calls", () => {
    const first = bucket("billing.new-checkout", "user-1");
    for (let index = 0; index < 1000; index += 1) {
      assert.equal(bucket("billing.new-checkout", "user-1"), first);
    }
  });

  it("stays inside 0..99", () => {
    for (let index = 0; index < 5000; index += 1) {
      const value = bucket("f", `user-${String(index)}`);
      assert.ok(value >= 0 && value < 100, `bucket was ${String(value)}`);
    }
  });

  it("spreads 10,000 subjects close to evenly", () => {
    const counts = Array.from({ length: 100 }, () => 0);
    for (let index = 0; index < 10_000; index += 1) {
      counts[bucket("billing.new-checkout", `user-${String(index)}`)] += 1;
    }

    // 100 buckets over 10,000 subjects averages 100 each. The tolerance is deliberately
    // loose: this pins that the hash spreads, not that it is uniform to a decimal place. A
    // hash that ignored part of its input, or that collapsed sequential ids onto a few
    // buckets, fails this by an order of magnitude.
    for (const [index, count] of counts.entries()) {
      assert.ok(
        count >= 50 && count <= 160,
        `bucket ${String(index)} held ${String(count)} of 10,000 subjects`
      );
    }
  });

  it("does not put the same subjects in the low buckets of two flags", () => {
    // Two flags rolled out to 10% must not reach the same tenth of the audience, or the
    // second experiment measures the first. The flag key is in the hash, so they do not.
    const inFirst = new Set<string>();
    const inSecond = new Set<string>();
    for (let index = 0; index < 2000; index += 1) {
      const subject = `user-${String(index)}`;
      if (bucket("flag.one", subject) < 10) {
        inFirst.add(subject);
      }
      if (bucket("flag.two", subject) < 10) {
        inSecond.add(subject);
      }
    }

    const shared = [...inFirst].filter((subject) => inSecond.has(subject));
    // Independent 10% rollouts overlap on about 1% of the audience — around 20 of 2,000.
    // Bucketing on the subject alone would make the smaller set a subset of the larger, so
    // the overlap would be the whole of one of them.
    assert.ok(inFirst.size > 100 && inSecond.size > 100);
    assert.ok(
      shared.length < inFirst.size / 2,
      `${String(shared.length)} of ${String(inFirst.size)} subjects were in both rollouts`
    );
  });
});
