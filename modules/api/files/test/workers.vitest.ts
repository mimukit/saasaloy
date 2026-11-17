import { describe, expect, it } from "vitest";
import { testWorkers } from "./workers";

const GIB = 1024 ** 3;

/** A box with room for more workers than any test asks for, so one bound decides. */
const ROOMY = { cpus: 64, memory: 64 * GIB };

describe(testWorkers, () => {
  it("uses half the CPUs", () => {
    expect(testWorkers({ ...ROOMY, cpus: 6 })).toBe(3);
    expect(testWorkers({ ...ROOMY, cpus: 7 })).toBe(3);
  });

  it("keeps 2 GiB back and gives each worker 1 GiB", () => {
    expect(testWorkers({ ...ROOMY, memory: 5 * GIB })).toBe(3);
    expect(testWorkers({ ...ROOMY, memory: 5.5 * GIB })).toBe(3);
  });

  it("never goes above 4 on its own", () => {
    expect(testWorkers(ROOMY)).toBe(4);
  });

  it("never goes below 1", () => {
    expect(testWorkers({ cpus: 1, memory: GIB })).toBe(1);
    expect(testWorkers({ cpus: 64, memory: 0 })).toBe(1);
  });

  it("takes API_TEST_WORKERS over the computed count", () => {
    expect(testWorkers({ ...ROOMY, override: "1" })).toBe(1);
    expect(testWorkers({ ...ROOMY, override: "8" })).toBe(8);
  });

  it("ignores an API_TEST_WORKERS that is not a count", () => {
    for (const override of ["", "0", "-2", "two", "1.5", "50%"]) {
      expect(testWorkers({ ...ROOMY, override })).toBe(4);
    }
  });
});
