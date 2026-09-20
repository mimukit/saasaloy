import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { childEnv, parseExecArgs } from "./exec.ts";

describe("parseExecArgs", () => {
  it("splits the file from the command", () => {
    assert.deepEqual(parseExecArgs(["infra/.env", "--", "pulumi", "up"]), {
      file: "infra/.env",
      command: "pulumi",
      commandArgs: ["up"],
    });
  });

  it("refuses a call with no separator or no command", () => {
    assert.throws(() => parseExecArgs(["infra/.env"]), /Usage: env-exec/);
    assert.throws(() => parseExecArgs(["infra/.env", "--"]), /Usage: env-exec/);
  });
});

describe("childEnv", () => {
  it("lets an exported variable win over the file", () => {
    const merged = childEnv(new Map([["A", "file"]]), {
      A: "shell",
      B: "shell",
    });
    assert.deepEqual(merged, { A: "shell", B: "shell" });
  });

  it("carries a key only the file sets", () => {
    assert.deepEqual(childEnv(new Map([["A", "file"]]), {}), { A: "file" });
  });
});
