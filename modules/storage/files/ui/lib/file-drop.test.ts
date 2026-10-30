// Tests for the FileDrop checks. This file is repo-only — it is not in the descriptor's
// file list — and runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileDropError, fileSize, uploadedSize } from "./file-drop.ts";

const MB = 1024 * 1024;
const png = (size: number) => ({ size, type: "image/png" });
const accept = ["image/png", "application/pdf"];

describe("fileDropError", () => {
  it("accepts a file of an allowed type within the cap", () => {
    assert.equal(fileDropError(png(MB), accept, 5 * MB), null);
  });

  it("refuses a type outside the list", () => {
    assert.equal(
      fileDropError({ size: MB, type: "text/html" }, accept, 5 * MB),
      "badType"
    );
  });

  it("takes any type when the accept list is empty", () => {
    assert.equal(
      fileDropError({ size: MB, type: "text/csv" }, [], 5 * MB),
      null
    );
  });

  it("refuses an empty file", () => {
    assert.equal(fileDropError(png(0), accept, 5 * MB), "empty");
  });

  it("refuses a file over the cap, and takes one at the cap", () => {
    assert.equal(fileDropError(png(5 * MB + 1), accept, 5 * MB), "tooLarge");
    assert.equal(fileDropError(png(5 * MB), accept, 5 * MB), null);
  });

  it("refuses any file once the list is full", () => {
    assert.equal(fileDropError(png(MB), accept, 5 * MB, 2, 3), null);
    assert.equal(fileDropError(png(MB), accept, 5 * MB, 3, 3), "tooMany");
  });
});

describe("fileSize", () => {
  it("rounds to whole kilobytes under a megabyte, never below 1", () => {
    assert.deepEqual(fileSize(10), { unit: "kb", size: "1" });
    assert.deepEqual(fileSize(300 * 1024), { unit: "kb", size: "300" });
  });

  it("gives megabytes with one decimal from 1 MB up", () => {
    assert.deepEqual(fileSize(2.4 * MB), { unit: "mb", size: "2.4" });
  });
});

describe("uploadedSize", () => {
  it("splits a megabyte total by the progress, clamped to 0..100", () => {
    assert.deepEqual(uploadedSize(2 * MB, 50), {
      unit: "mb",
      done: "1.0",
      total: "2.0",
    });
    assert.deepEqual(uploadedSize(2 * MB, 150), {
      unit: "mb",
      done: "2.0",
      total: "2.0",
    });
    assert.deepEqual(uploadedSize(2 * MB, -5), {
      unit: "mb",
      done: "0.0",
      total: "2.0",
    });
  });

  it("counts a file under 1 MB in kilobytes, so it never reads 0.0 of 0.0", () => {
    assert.deepEqual(uploadedSize(12 * 1024, 50), {
      unit: "kb",
      done: "6",
      total: "12",
    });
  });
});
