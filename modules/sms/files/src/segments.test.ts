// Tests for the segment estimate in ./segments.ts: the single-part limits of both encodings, the
// step to a concatenated message, and the GSM-7 extension characters that cost two septets.
// Repo-only (the descriptor does not list it); it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countSegments, measureSegments } from "./segments.ts";

describe("measureSegments: GSM-7", () => {
  it("fits 160 characters in one segment", () => {
    assert.deepEqual(measureSegments("a".repeat(160)), {
      encoding: "gsm-7",
      units: 160,
      segments: 1,
    });
  });

  it("splits 161 characters into two parts of 153", () => {
    assert.deepEqual(measureSegments("a".repeat(161)), {
      encoding: "gsm-7",
      units: 161,
      segments: 2,
    });
  });

  it("counts an extension character as two septets", () => {
    assert.deepEqual(measureSegments("€"), {
      encoding: "gsm-7",
      units: 2,
      segments: 1,
    });
  });

  it("pushes 159 characters plus one extension character to two segments", () => {
    const body = `${"a".repeat(159)}€`;
    assert.equal(measureSegments(body).units, 161);
    assert.equal(countSegments(body), 2);
  });
});

describe("measureSegments: UCS-2", () => {
  it("fits 70 characters in one segment", () => {
    assert.deepEqual(measureSegments("অ".repeat(70)), {
      encoding: "ucs-2",
      units: 70,
      segments: 1,
    });
  });

  it("splits 71 characters into two parts of 67", () => {
    assert.deepEqual(measureSegments("অ".repeat(71)), {
      encoding: "ucs-2",
      units: 71,
      segments: 2,
    });
  });

  it("switches the whole body to UCS-2 for one non-GSM character", () => {
    assert.equal(measureSegments(`${"a".repeat(69)}✅`).encoding, "ucs-2");
  });
});
