// Guards the provider selection rule (AGENTS.md, "Architecture philosophy") in every
// capability core. `<CAP>_PROVIDER` is required, and an unset or unknown value throws at
// construction. Two cores differ on purpose: `logger` is optional (unset selects the first
// provider, an unknown name still throws), and `payment` takes a comma list in priority order
// (unset, an empty list or one unknown name throws).
//
// Each core keeps its own copy of the selector in `modules/<cap>/files/src/define.ts`, because a
// project owns that file. This test is the one place that checks all the copies still follow
// the rule. A core is a module with both `files/src/define.ts` and a `files/src/providers/`
// folder. The set comes from disk, so a new core with no row in CORES fails here and names
// itself.
//
// It calls `define<Cap>({ providers: [stub] }).create(env)` with stub providers, so it tests the
// selector, never an installed vendor. The payload imports have no file extension, so
// `pnpm test:scripts` loads `./ts-resolve-hook.ts`, the hook `pnpm test:modules` uses. The
// imports are dynamic, which keeps `tsc -p tsconfig.scripts.json` out of the payload code.

import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

/**
 * `required`: unset throws, unknown throws, a known name selects that provider.
 * `optional`: unset selects the first provider, unknown throws, a known name selects it.
 * `list`: unset, empty and one unknown name throw; known names select in the listed order.
 */
type Mode = "required" | "optional" | "list";

interface Core {
  /** The module folder under `modules/`. */
  module: string;
  /** The env key the selector reads. Every expected throw must name it. */
  envKey: string;
  /** The `define<Cap>` export of `define.ts`. */
  factory: string;
  mode: Mode;
  /** Config fields other than `providers` that `define<Cap>` needs. */
  config?: Record<string, unknown>;
  /** A provider the core accepts at construction. Most read only `name`. */
  stub?: (name: string) => Record<string, unknown>;
}

const CORES: Core[] = [
  {
    module: "email",
    envKey: "EMAIL_PROVIDER",
    factory: "defineEmail",
    mode: "required",
  },
  {
    module: "sms",
    envKey: "SMS_PROVIDER",
    factory: "defineSms",
    mode: "required",
  },
  {
    module: "queue",
    envKey: "QUEUE_PROVIDER",
    factory: "defineQueue",
    mode: "required",
    config: { jobs: [], schedules: [] },
  },
  {
    module: "kv",
    envKey: "KV_PROVIDER",
    factory: "defineKv",
    mode: "required",
    config: { policies: [] },
  },
  {
    module: "storage",
    envKey: "STORAGE_PROVIDER",
    factory: "defineStorage",
    mode: "required",
  },
  {
    module: "subscription",
    envKey: "SUBSCRIPTION_PROVIDER",
    factory: "defineSubscription",
    mode: "required",
  },
  {
    module: "logger",
    envKey: "LOGGER_PROVIDER",
    factory: "defineLogger",
    mode: "optional",
  },
  {
    module: "payment",
    envKey: "PAYMENT_PROVIDER",
    factory: "definePayment",
    mode: "list",
    config: { listeners: [] },
  },
];

/** What every `create(env)` answers: `provider` for one selected name, `providers` for a list. */
interface Client {
  provider?: string;
  providers?: string[];
}

interface Registry {
  create(env: Record<string, unknown>): Client;
}

type Define = (config: Record<string, unknown>) => Registry;

/** The modules on disk that carry a provider selector. */
function coresOnDisk(): string[] {
  return readdirSync(MODULES)
    .filter((module) => {
      const src = join(MODULES, module, "files", "src");
      const providers = join(src, "providers");
      return (
        existsSync(join(src, "define.ts")) &&
        existsSync(providers) &&
        statSync(providers).isDirectory()
      );
    })
    .toSorted();
}

async function loadDefine(core: Core): Promise<Define> {
  const path = join(MODULES, core.module, "files", "src", "define.ts");
  const loaded = (await import(pathToFileURL(path).href)) as Record<
    string,
    unknown
  >;
  const define = loaded[core.factory];
  assert.equal(
    typeof define,
    "function",
    `modules/${core.module}/files/src/define.ts exports no ${core.factory}`
  );
  return define as Define;
}

/** A registry over stub providers named `names`, in that order. */
async function registryOf(core: Core, names: string[]): Promise<Registry> {
  const define = await loadDefine(core);
  const stub = core.stub ?? ((name: string) => ({ name }));
  return define({ ...core.config, providers: names.map(stub) });
}

/** The provider names a client selected, in order. */
function selected(client: Client): string[] {
  if (Array.isArray(client.providers)) {
    return client.providers;
  }
  return client.provider === undefined ? [] : [client.provider];
}

/** Assert that `create(env)` throws an error whose message names the core's env key. */
function expectThrow(
  core: Core,
  registry: Registry,
  env: Record<string, unknown>,
  why: string
): void {
  assert.throws(
    () => registry.create(env),
    (error: unknown) => {
      assert.ok(
        error instanceof Error && error.message.includes(core.envKey),
        `${core.module}: ${why} threw, but the message does not name ${core.envKey}: ${String(error)}`
      );
      return true;
    },
    `${core.module}: ${why} must throw at construction, naming ${core.envKey}`
  );
}

function expectSelects(
  core: Core,
  registry: Registry,
  env: Record<string, unknown>,
  expected: string[],
  why: string
): void {
  assert.deepEqual(
    selected(registry.create(env)),
    expected,
    `${core.module}: ${why} must select ${expected.join(", ")} (${core.envKey})`
  );
}

describe("provider selection: the table", () => {
  it("has one row for every capability core on disk", () => {
    const onDisk = coresOnDisk();
    const inTable = CORES.map((core) => core.module).toSorted();
    const missing = onDisk.filter((module) => !inTable.includes(module));
    const extra = inTable.filter((module) => !onDisk.includes(module));

    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      [
        missing.length > 0
          ? `capability cores with no row in CORES: ${missing.join(", ")}. Add a row with the core's env key, its define export and its mode.`
          : "",
        extra.length > 0
          ? `rows in CORES with no core on disk: ${extra.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  });

  it("guards 8 cores", () => {
    assert.equal(CORES.length, 8);
  });
});

for (const core of CORES) {
  describe(`provider selection: ${core.module} (${core.envKey}, ${core.mode})`, () => {
    if (core.mode === "required") {
      it(`throws when ${core.envKey} is unset or empty`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectThrow(core, registry, {}, "an unset value");
        expectThrow(core, registry, { [core.envKey]: "" }, "an empty value");
      });
    }

    if (core.mode === "optional") {
      it(`selects the first provider when ${core.envKey} is unset`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectSelects(core, registry, {}, ["alpha"], "an unset value");
      });
    }

    if (core.mode === "list") {
      it(`throws when ${core.envKey} is unset, empty or holds only commas`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectThrow(core, registry, {}, "an unset value");
        expectThrow(core, registry, { [core.envKey]: "" }, "an empty list");
        expectThrow(
          core,
          registry,
          { [core.envKey]: " , " },
          "a list of blanks"
        );
      });

      it(`throws when one name in ${core.envKey} is unknown`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectThrow(
          core,
          registry,
          { [core.envKey]: "alpha,zzz" },
          "a list with one unknown name"
        );
      });

      it(`selects the listed providers in the listed order`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectSelects(
          core,
          registry,
          { [core.envKey]: "beta,alpha" },
          ["beta", "alpha"],
          '"beta,alpha"'
        );
      });
    } else {
      it(`throws when ${core.envKey} names an unknown provider`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectThrow(
          core,
          registry,
          { [core.envKey]: "zzz" },
          "an unknown name"
        );
      });

      it(`selects the provider ${core.envKey} names, not the first one`, async () => {
        const registry = await registryOf(core, ["alpha", "beta"]);
        expectSelects(
          core,
          registry,
          { [core.envKey]: "beta" },
          ["beta"],
          '"beta"'
        );
      });
    }
  });
}
