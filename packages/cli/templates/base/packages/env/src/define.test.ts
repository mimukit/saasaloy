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

  // The order a capability relies on to let a provider tighten one of its keys: kv keeps
  // its own keys in an inner preset first in `extends`, and kv-upstash appends after it.
  it("lets a later preset in extends override an earlier one", () => {
    const core = definePreset({
      module: "@repo/kv",
      server: { PREFIX: optional("") },
    });
    const loose = createEnv({
      extends: [definePreset({ module: "@repo/kv", extends: [core] })],
    });
    assert.equal(loose({ PREFIX: "" }).PREFIX, "");

    const strict = createEnv({
      extends: [
        definePreset({
          module: "@repo/kv",
          extends: [
            core,
            definePreset({
              module: "kv-upstash",
              server: { PREFIX: required() },
            }),
          ],
        }),
      ],
    });
    const error = caught(() => strict({ PREFIX: "" }));
    assert.deepEqual(
      error.issues.map((issue) => [issue.key, issue.module, issue.reason]),
      [["PREFIX", "kv-upstash", "unset"]]
    );
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

// #390: a provider's key is required only while its provider is selected.
describe("createEnv requiredWhen", () => {
  /** A key's own schema for a conditional key: a non-empty string, or unset. */
  function maybe(): StandardSchema<unknown, string | undefined> {
    return {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) =>
          value === undefined || (typeof value === "string" && value !== "")
            ? { value }
            : { issues: [{ message: "expected a string" }] },
      },
    };
  }

  /** A controlling key that defaults when unset and lowercases what it gets. */
  function provider(fallback: string): StandardSchema<unknown, string> {
    return {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) => ({
          value: typeof value === "string" ? value.toLowerCase() : fallback,
        }),
      },
    };
  }

  const email = definePreset({
    module: "@repo/email",
    server: { EMAIL_PROVIDER: required(), EMAIL_FROM: maybe() },
    requiredWhen: { EMAIL_FROM: { key: "EMAIL_PROVIDER", isNot: "console" } },
  });
  const plunk = definePreset({
    module: "email-plunk",
    server: { PLUNK_API_KEY: maybe() },
    requiredWhen: { PLUNK_API_KEY: { key: "EMAIL_PROVIDER", is: "plunk" } },
  });

  it("leaves a conditional key optional while its condition is false", () => {
    const env = createEnv({ extends: [email, plunk] });
    const values = env({
      EMAIL_PROVIDER: "console",
      EMAIL_FROM: "",
      PLUNK_API_KEY: "",
    });
    assert.equal(values.PLUNK_API_KEY, undefined);
  });

  it("names the key, its module and the condition while it is true", () => {
    const env = createEnv({ extends: [email, plunk] });
    const error = caught(() =>
      env({ EMAIL_PROVIDER: "plunk", EMAIL_FROM: "", PLUNK_API_KEY: "" })
    );
    assert.deepEqual(
      error.issues.map(({ key, module, reason }) => ({ key, module, reason })),
      [
        {
          key: "EMAIL_FROM",
          module: "@repo/email",
          reason: "unset; required when EMAIL_PROVIDER!=console",
        },
        {
          key: "PLUNK_API_KEY",
          module: "email-plunk",
          reason: "unset; required when EMAIL_PROVIDER=plunk",
        },
      ]
    );
  });

  it("passes once the key is set", () => {
    const env = createEnv({ extends: [email, plunk] });
    const values = env({
      EMAIL_PROVIDER: "plunk",
      EMAIL_FROM: "me@x.com",
      PLUNK_API_KEY: "sk",
    });
    assert.equal(values.PLUNK_API_KEY, "sk");
  });

  it("reads the controlling key after it parses", () => {
    const env = createEnv({
      extends: [
        definePreset({
          module: "@repo/kv",
          server: { KV_PROVIDER: provider("upstash"), KV_KEY_PREFIX: maybe() },
          requiredWhen: {
            KV_KEY_PREFIX: { key: "KV_PROVIDER", is: "upstash" },
          },
        }),
      ],
    });
    // Unset, then a value the schema lowercases: both parse to `upstash`.
    assert.deepEqual(
      caught(() => env({})).issues.map((issue) => issue.key),
      ["KV_KEY_PREFIX"]
    );
    assert.deepEqual(
      caught(() => env({ KV_PROVIDER: "UPSTASH" })).issues.map(
        (issue) => issue.key
      ),
      ["KV_KEY_PREFIX"]
    );
  });

  it("reports a conditional key beside a key that failed its own schema", () => {
    const env = createEnv({
      extends: [email, plunk],
      server: { A: required() },
    });
    const error = caught(() =>
      env({ EMAIL_PROVIDER: "plunk", EMAIL_FROM: "x" })
    );
    assert.deepEqual(
      error.issues.map((issue) => issue.key),
      ["A", "PLUNK_API_KEY"]
    );
  });

  it("skips a condition on a server key on the client", () => {
    const env = createEnv({
      extends: [email, plunk],
      isServer: false,
      runtimeEnvStrict: {},
    });
    assert.doesNotThrow(() => env());
  });

  it("matches a name in a list-valued controlling key", () => {
    const payment = definePreset({
      module: "payment-bkash",
      server: { PAYMENT_PROVIDER: required(), BKASH_APP_KEY: maybe() },
      requiredWhen: { BKASH_APP_KEY: { key: "PAYMENT_PROVIDER", is: "bkash" } },
    });
    const env = createEnv({ extends: [payment] });
    assert.deepEqual(
      caught(() => env({ PAYMENT_PROVIDER: "manual, bkash" })).issues.map(
        (issue) => issue.key
      ),
      ["BKASH_APP_KEY"]
    );
    assert.doesNotThrow(() => env({ PAYMENT_PROVIDER: "manual,bkashx" }));
  });

  it("requires a key two presets make conditional when either condition holds", () => {
    const kv = definePreset({
      module: "kv-upstash",
      server: { KV_PROVIDER: required(), KV_KEY_PREFIX: maybe() },
      requiredWhen: { KV_KEY_PREFIX: { key: "KV_PROVIDER", is: "upstash" } },
    });
    const redis = definePreset({
      module: "kv-redis",
      server: { KV_KEY_PREFIX: maybe() },
      requiredWhen: { KV_KEY_PREFIX: { key: "KV_PROVIDER", is: "redis" } },
    });
    const env = createEnv({ extends: [kv, redis] });
    assert.equal(
      caught(() => env({ KV_PROVIDER: "redis" })).issues[0]?.module,
      "kv-redis"
    );
    assert.equal(
      caught(() => env({ KV_PROVIDER: "upstash" })).issues[0]?.module,
      "kv-upstash"
    );
    assert.doesNotThrow(() => env({ KV_PROVIDER: "memory" }));
    // Both conditions hold: the key is reported once.
    assert.equal(
      caught(() => env({ KV_PROVIDER: "upstash,redis" })).issues.length,
      1
    );
  });

  it("keeps a key required when one preset requires it and another makes it conditional, in either order", () => {
    const core = definePreset({
      module: "core",
      server: { P: required(), X: required() },
    });
    const vendor = definePreset({
      module: "vendor",
      server: { X: maybe() },
      requiredWhen: { X: { key: "P", is: "vendor" } },
    });
    for (const presets of [
      [core, vendor],
      [vendor, core],
    ]) {
      const env = createEnv({ extends: presets });
      assert.deepEqual(
        caught(() => env({ P: "local", X: "" })).issues.map((issue) => [
          issue.key,
          issue.module,
        ]),
        [["X", "core"]]
      );
      assert.doesNotThrow(() => env({ P: "local", X: "set" }));
    }
  });
});
