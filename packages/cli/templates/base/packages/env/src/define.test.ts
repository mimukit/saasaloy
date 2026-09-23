import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, definePreset, EnvValidationError } from "./define.ts";
import type { StandardSchema } from "./schema.ts";

// Hand-written Standard Schemas, so these tests prove the core is validator-blind: no zod
// is imported anywhere below, and `createEnv` never learns which vendor wrote them.

function required(label = "a string"): StandardSchema<unknown, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) =>
        typeof value === "string" && value !== ""
          ? { value }
          : { issues: [{ message: `expected ${label}` }] },
    },
  };
}

function optional(fallback: string): StandardSchema<unknown, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({
        value: typeof value === "string" ? value : fallback,
      }),
    },
  };
}

/** The error a call threw, so a test can read its fields. */
function caught(fn: () => unknown): EnvValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error;
  }
  throw new Error("expected a throw");
}

describe("createEnv", () => {
  it("returns the parsed values", () => {
    const env = createEnv({ server: { A: required() } });
    assert.equal(env({ A: "one" }).A, "one");
  });

  it("names every failing key in one throw", () => {
    const env = createEnv({
      extends: [
        definePreset({ module: "@repo/kv", server: { KV: required() } }),
      ],
      server: { A: required(), B: required() },
    });
    const error = caught(() => env({}));
    assert.deepEqual(
      error.issues.map((issue) => issue.key),
      ["KV", "A", "B"]
    );
    assert.equal(error.issues[0]?.module, "@repo/kv");
    assert.match(error.message, /3 environment keys are missing or invalid/);
  });

  it("reports the declaring module's own wording", () => {
    const schema = required();
    (schema as { description?: string }).description = "where mail comes from";
    const env = createEnv({
      extends: [
        definePreset({ module: "@repo/email", server: { FROM: schema } }),
      ],
    });
    const error = caught(() => env({}));
    assert.equal(error.issues[0]?.description, "where mail comes from");
    assert.match(error.message, /where mail comes from/);
  });

  it("treats an empty string as unset by default", () => {
    const env = createEnv({ server: { A: required() } });
    const error = caught(() => env({ A: "" }));
    assert.equal(error.issues[0]?.reason, "unset");
  });

  it("keeps an empty string when emptyStringAsUndefined is off", () => {
    const env = createEnv({
      server: { A: optional("fallback") },
      emptyStringAsUndefined: false,
    });
    assert.equal(env({ A: "" }).A, "");
  });

  it("memoizes per source object", () => {
    let calls = 0;
    const counted: StandardSchema<unknown, string> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) => {
          calls += 1;
          return { value: String(value) };
        },
      },
    };
    const env = createEnv({ server: { A: counted } });
    const source = { A: "one" };
    env(source);
    env(source);
    assert.equal(calls, 1);
    env({ A: "one" });
    assert.equal(calls, 2);
  });

  it("skips validation when the build-time flag is set", () => {
    const env = createEnv({ server: { A: required() }, skipValidation: true });
    assert.equal(env({}).A, undefined);
  });

  it("calls onValidationError instead of throwing its own error", () => {
    const seen: string[] = [];
    const env = createEnv({
      server: { A: required() },
      onValidationError: (issues) => {
        seen.push(...issues.map((issue) => issue.key));
        throw new Error("mine");
      },
    });
    assert.throws(() => env({}), /mine/);
    assert.deepEqual(seen, ["A"]);
  });

  it("refuses a client key without the prefix", () => {
    assert.throws(
      () =>
        createEnv({
          // @ts-expect-error a client key must start with PUBLIC_, and the type says so
          client: { SECRET: required() },
        }),
      /does not start with PUBLIC_/
    );
  });

  it("accepts a client key that carries the prefix", () => {
    const env = createEnv({
      client: { PUBLIC_A: required() },
      runtimeEnvStrict: { PUBLIC_A: "one" },
      isServer: false,
    });
    assert.equal(env().PUBLIC_A, "one");
  });

  it("throws when client code reads a server key", () => {
    const env = createEnv({
      extends: [
        definePreset({ module: "@repo/auth", server: { SECRET: required() } }),
      ],
      client: { PUBLIC_A: required() },
      runtimeEnvStrict: { PUBLIC_A: "one", SECRET: "leaked" },
      isServer: false,
    });
    const values = env();
    assert.equal(values.PUBLIC_A, "one");
    assert.throws(
      () => values.SECRET,
      /SECRET is a server environment key and this code runs on the client/
    );
  });

  it("does not validate server keys on the client", () => {
    const env = createEnv({
      server: { SECRET: required() },
      client: { PUBLIC_A: required() },
      runtimeEnvStrict: { PUBLIC_A: "one" },
      isServer: false,
    });
    assert.equal(env().PUBLIC_A, "one");
  });

  it("reads a shared key on both sides", () => {
    const shared = { MODE: required() };
    assert.equal(createEnv({ shared })({ MODE: "dev" }).MODE, "dev");
    assert.equal(
      createEnv({
        shared,
        isServer: false,
        runtimeEnvStrict: { MODE: "dev" },
      })().MODE,
      "dev"
    );
  });

  it("refuses an async validator", () => {
    const async: StandardSchema<unknown, string> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async () => await Promise.resolve({ value: "one" }),
      },
    };
    assert.throws(
      () => createEnv({ server: { A: async } })({ A: "one" }),
      /cannot await one/
    );
  });
});
