import { describe, expect, it } from "vitest";
import {
  listLabel,
  requestedArgv,
  requestedLabel,
  subjectOf,
} from "./requested.js";

// #233: one name reads as it always did; several name the root that pulled a module in.
describe("requested — naming what the user typed", () => {
  const set = {
    names: ["waitlist", "admin"],
    rootOf: new Map([
      ["api", "waitlist"],
      ["auth", "admin"],
    ]),
  };

  it("lists names as prose", () => {
    expect(listLabel(["a"])).toBe("a");
    expect(listLabel(["a", "b"])).toBe("a and b");
    expect(listLabel(["a", "b", "c"])).toBe("a, b and c");
    expect(requestedLabel("waitlist")).toBe("waitlist");
    expect(requestedLabel(set)).toBe("waitlist and admin");
  });

  it("joins names with spaces for a command line", () => {
    expect(requestedArgv(set)).toBe("waitlist admin");
    expect(requestedArgv("waitlist")).toBe("waitlist");
  });

  it("names a prerequisite with the root that pulled it in", () => {
    expect(subjectOf("admin", set)).toBe("admin");
    expect(subjectOf("auth", set)).toBe("auth (required by admin)");
    expect(subjectOf("api", set)).toBe("api (required by waitlist)");
  });

  it("reads one name exactly as before", () => {
    expect(subjectOf("waitlist", "waitlist")).toBe("waitlist");
    expect(subjectOf("api", "waitlist")).toBe("api (required by waitlist)");
  });
});
