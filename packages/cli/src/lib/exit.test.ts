import { afterEach, describe, expect, it } from "vitest";
import {
  causeChain,
  DEBUG_ENV,
  EXIT_FAILURE,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
  isRefusal,
  RefusalError,
} from "./exit.js";

afterEach(() => {
  delete process.env[DEBUG_ENV];
});

describe(exitCodeFor, () => {
  it("maps a refusal to 2 and anything else to 1", () => {
    expect(exitCodeFor(new RefusalError("no"))).toBe(EXIT_REFUSED);
    expect(exitCodeFor(new Error("broke"))).toBe(EXIT_FAILURE);
    expect(exitCodeFor("a string nobody threw on purpose")).toBe(EXIT_FAILURE);
  });

  it("recognises a refusal thrown through a library boundary", () => {
    expect(isRefusal(new RefusalError("no"))).toBeTruthy();
    expect(isRefusal(new TypeError("no"))).toBeFalsy();
  });
});

describe(causeChain, () => {
  it("walks every cause, outermost first", () => {
    const root = new Error("ECONNREFUSED");
    const middle = new Error("fetch failed", { cause: root });
    const outer = new Error("Could not fetch module", { cause: middle });
    expect(causeChain(outer)).toStrictEqual([middle, root]);
  });

  it("returns nothing when nothing wrapped anything", () => {
    expect(causeChain(new Error("flat"))).toStrictEqual([]);
    expect(causeChain("not an error")).toStrictEqual([]);
  });

  it("stops on a cause cycle instead of looping", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(causeChain(a).length).toBeLessThanOrEqual(10);
  });
});

describe(formatFailure, () => {
  it("prints only the message when the debug switch is off", () => {
    const error = new Error("outer", { cause: new Error("inner") });
    expect(formatFailure(error)).toBe("outer");
  });

  it("prints the cause chain when the debug switch is on", () => {
    process.env[DEBUG_ENV] = "1";
    const error = new Error("outer", { cause: new Error("inner") });
    const text = formatFailure(error);
    expect(text).toContain("outer");
    expect(text).toContain("caused by:");
    expect(text).toContain("inner");
  });

  it("treats an empty debug value as off", () => {
    process.env[DEBUG_ENV] = "";
    const error = new Error("outer", { cause: new Error("inner") });
    expect(formatFailure(error)).toBe("outer");
  });
});
