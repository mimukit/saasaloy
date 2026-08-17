import { afterEach, describe, expect, it } from "vitest";
import { isInteractive } from "./tui.js";

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

afterEach(() => {
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
});

describe("isInteractive", () => {
  it("is true only when both stdin and stdout are TTYs", () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    expect(isInteractive()).toBe(true);
  });

  it("is false when stdin is piped (echo '' | saasaloy)", () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = true;
    expect(isInteractive()).toBe(false);
  });

  it("is false when stdout is redirected (saasaloy | cat)", () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    expect(isInteractive()).toBe(false);
  });

  it("is false when neither is a TTY (CI)", () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    expect(isInteractive()).toBe(false);
  });

  it("reads the streams at call time, not at module load", () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    expect(isInteractive()).toBe(true);
    process.stdout.isTTY = false;
    expect(isInteractive()).toBe(false);
  });
});
