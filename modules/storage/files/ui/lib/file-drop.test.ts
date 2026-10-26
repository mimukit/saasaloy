// Tests for the FileDrop checks. This file is repo-only — it is not in the descriptor's
// file list — and runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileDropError, fileSize, uploadedMegabytes } from "./file-drop.ts";

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

describe("uploadedMegabytes", () => {
  it("splits the total by the progress, clamped to 0..100", () => {
    assert.deepEqual(uploadedMegabytes(2 * MB, 50), {
      done: "1.0",
      total: "2.0",
    });
    assert.deepEqual(uploadedMegabytes(2 * MB, 150), {
      done: "2.0",
      total: "2.0",
    });
    assert.deepEqual(uploadedMegabytes(2 * MB, -5), {
      done: "0.0",
      total: "2.0",
    });
  });
});
