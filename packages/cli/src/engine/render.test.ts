import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { RefusalError } from "../lib/exit.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import type { RegistryItem } from "../lib/schema.js";
import { loadPayload } from "./payload.js";
import type { Payload, PayloadModule } from "./payload.js";
import { fixedOrder, render } from "./render.js";
import type { RenderResult } from "./render.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MODULES_DIR = join(REPO_ROOT, "modules");

const AGENTS = [
  "# Agents",
  "<!-- saasaloy:testing -->",
  "placeholder",
  "<!-- /saasaloy:testing -->",
  "",
].join("\n");

function moduleOf(
  item: Partial<RegistryItem> & { name: string },
  files: Record<string, string> = {}
): PayloadModule {
  return {
    files: new Map(Object.entries(files)),
    item: { type: "saasaloy:feature", ...item },
    name: item.name,
  };
}

/** A small payload: a base with an alias, and the modules given. */
function payloadOf(modules: PayloadModule[]): Payload {
  return {
    base: {
      declaration: {
        ownedFiles: ["packages/ui/src/blocks/**"],
        retiredSeedFiles: [],
        seedFiles: ["README.md"],
      },
      files: new Map([
        ["AGENTS.md", AGENTS],
        ["README.md", "# {{PROJECT_NAME}}\n"],
        ["_gitignore", "node_modules\n"],
        [
          "package.json",
          `${JSON.stringify({ name: "{{PROJECT_NAME}}", scripts: {} }, null, 2)}\n`,
        ],
        ["packages/ui/src/blocks/hero.tsx", "export const Hero = 1;\n"],
        [
          "saasaloy.json",
          `${JSON.stringify({ aliases: { "@web": "apps/web/src" }, base: "web", installed: [] }, null, 2)}\n`,
        ],
      ]),
    },
    modules: new Map(modules.map((mod) => [mod.name, mod])),
    ref: "test",
    source: "test",
  };
}

function renderOf(payload: Payload, requested: string[]): RenderResult {
  return render({
    options: { projectName: "demo", testingMode: "off" },
    payload,
    requested,
  });
}

describe(fixedOrder, () => {
  it("places dependencies first, then the lowest name", () => {
    const modules = new Map(
      [
        moduleOf({ name: "z" }),
        moduleOf({ dependsOn: ["m"], name: "a" }),
        moduleOf({ name: "m" }),
      ].map((mod) => [mod.name, mod])
    );
    expect(fixedOrder(modules, ["z", "a", "m"])).toStrictEqual(["m", "a", "z"]);
  });

  it("throws on a dependency cycle", () => {
    const modules = new Map(
      [
        moduleOf({ dependsOn: ["b"], name: "a" }),
        moduleOf({ dependsOn: ["a"], name: "b" }),
      ].map((mod) => [mod.name, mod])
    );
    expect(() => fixedOrder(modules, ["a", "b"])).toThrow(/cycle/);
  });
});

describe(render, () => {
  it("renames `_name`, fills tokens and sets the testing block", () => {
    const result = renderOf(payloadOf([]), []);
    expect(result.files.get(".gitignore")?.content).toBe("node_modules\n");
    expect(result.files.has("_gitignore")).toBeFalsy();
    expect(result.files.get(".gitignore")?.from).toBe("_gitignore");
    expect(result.files.get("README.md")?.content).toBe("# demo\n");
    expect(result.files.get("AGENTS.md")?.content).toContain(
      "Testing mode: `off`."
    );
    const config = JSON.parse(
      result.files.get("saasaloy.json")?.content ?? "{}"
    ) as Record<string, unknown>;
    expect(config).toMatchObject({ name: "demo", testing: { mode: "off" } });
  });

  it("gives each file its class, module and source path", () => {
    const result = renderOf(
      payloadOf([
        moduleOf(
          {
            files: [
              { path: "files/a.ts", target: "@web/a.ts" },
              { path: "files/seed.ts", seed: true, target: "@web/seed.ts" },
            ],
            name: "widget",
          },
          { "files/a.ts": "a\n", "files/seed.ts": "seed\n" }
        ),
      ]),
      ["widget"]
    );
    const pick = (path: string): unknown => {
      const file = result.files.get(path);
      return (
        file && { class: file.class, from: file.from, module: file.module }
      );
    };
    expect(pick("apps/web/src/a.ts")).toStrictEqual({
      class: "merged",
      from: "files/a.ts",
      module: "widget",
    });
    expect(pick("apps/web/src/seed.ts")).toMatchObject({ class: "once" });
    expect(pick("README.md")).toMatchObject({ class: "once", module: "base" });
    expect(pick("packages/ui/src/blocks/hero.tsx")).toMatchObject({
      class: "once",
    });
    expect(pick("package.json")).toMatchObject({ class: "merged" });
    expect(pick("saasaloy.json")).toMatchObject({ class: "merged" });
  });

  it("applies patches in the fixed order, whatever order the names arrive in", () => {
    const script = (name: string): PayloadModule =>
      moduleOf({
        name,
        patches: [
          {
            file: "package.json",
            kind: "package-json-script",
            name: `${name}:run`,
            value: `run ${name} {{PROJECT_NAME}}`,
          },
        ],
      });
    const payload = payloadOf([script("zeta"), script("alpha")]);
    const forward = renderOf(payload, ["alpha", "zeta"]);
    const backward = renderOf(payload, ["zeta", "alpha"]);
    const scripts = Object.entries(
      (
        JSON.parse(forward.files.get("package.json")?.content ?? "{}") as {
          scripts: Record<string, string>;
        }
      ).scripts
    );
    expect(scripts).toStrictEqual([
      ["alpha:run", "run alpha demo"],
      ["zeta:run", "run zeta demo"],
    ]);
    expect(backward.files.get("package.json")?.content).toBe(
      forward.files.get("package.json")?.content
    );
    expect(forward.order).toStrictEqual(["alpha", "zeta"]);
  });

  it("refuses two unrelated modules that write one path", () => {
    const writer = (name: string): PayloadModule =>
      moduleOf(
        { files: [{ path: "files/x.ts", target: "@web/x.ts" }], name },
        { "files/x.ts": name }
      );
    expect(() =>
      renderOf(payloadOf([writer("one"), writer("two")]), ["one", "two"])
    ).toThrow(RefusalError);
  });

  it("lets a module that depends on another take its path", () => {
    const core = moduleOf(
      { files: [{ path: "files/x.ts", target: "@web/x.ts" }], name: "core" },
      { "files/x.ts": "core\n" }
    );
    const driver = moduleOf(
      {
        dependsOn: ["core"],
        files: [{ path: "files/x.ts", target: "@web/x.ts" }],
        name: "driver",
      },
      { "files/x.ts": "driver\n" }
    );
    const result = renderOf(payloadOf([core, driver]), ["driver"]);
    expect(result.files.get("apps/web/src/x.ts")).toMatchObject({
      content: "driver\n",
      module: "driver",
    });
  });

  it("refuses a module the payload lacks", () => {
    expect(() => renderOf(payloadOf([]), ["ghost"])).toThrow(RefusalError);
  });
});

describe("generated tables (plan 0116, Phase 7)", () => {
  const owner = moduleOf(
    {
      files: [{ path: "files/index.ts", target: "@web/index.ts" }],
      name: "email",
      tables: [
        {
          file: "@web/providers.generated.ts",
          id: "email.providers",
          shape: "calls",
        },
      ],
    },
    { "files/index.ts": "export {};\n" }
  );
  const provider = (name: string, extra: Partial<RegistryItem> = {}) =>
    moduleOf({
      dependsOn: ["email"],
      entries: [
        {
          call: `${name}Email`,
          import: { from: `./providers/${name}`, name: `${name}Email` },
          table: "email.providers",
        },
      ],
      name,
      ...extra,
    });

  it("writes the table as a generated file owned by its module, rows sorted by module name", () => {
    const payload = payloadOf([owner, provider("plunk"), provider("console")]);
    const result = renderOf(payload, ["plunk", "console"]);
    const file = result.files.get("apps/web/src/providers.generated.ts");
    expect(file).toMatchObject({ class: "generated", module: "email" });
    expect(file?.content).toContain(
      "export const emailProviders = [consoleEmail(), plunkEmail()];"
    );
    expect(
      renderOf(payload, ["console", "plunk"]).files.get(
        "apps/web/src/providers.generated.ts"
      )?.content
    ).toBe(file?.content);
  });

  it("puts a lower order first and drops the row of a module outside the set", () => {
    const first = provider("zeta", {
      entries: [
        {
          call: "zetaEmail",
          import: { from: "./providers/zeta", name: "zetaEmail" },
          order: 10,
          table: "email.providers",
        },
      ],
    });
    const payload = payloadOf([owner, first, provider("alpha")]);
    expect(
      renderOf(payload, ["zeta", "alpha"]).files.get(
        "apps/web/src/providers.generated.ts"
      )?.content
    ).toContain("[zetaEmail(), alphaEmail()]");
    expect(
      renderOf(payload, ["alpha"]).files.get(
        "apps/web/src/providers.generated.ts"
      )?.content
    ).toContain("[alphaEmail()]");
  });

  it("writes an empty table when no module adds a row", () => {
    const result = renderOf(payloadOf([owner]), ["email"]);
    expect(
      result.files.get("apps/web/src/providers.generated.ts")?.content
    ).toContain("export const emailProviders = [];");
  });

  it("skips a row whose when fails, and warns about a row with no table", () => {
    const gated = provider("gated", {
      entries: [
        {
          call: "gatedEmail",
          import: { from: "./providers/gated", name: "gatedEmail" },
          table: "email.providers",
          when: { testing: true },
        },
        {
          call: "lost",
          import: { from: "./lost", name: "lost" },
          table: "nowhere.list",
        },
      ],
    });
    const result = renderOf(payloadOf([owner, gated]), ["gated"]);
    expect(
      result.files.get("apps/web/src/providers.generated.ts")?.content
    ).toContain("export const emailProviders = [];");
    expect(result.warnings).toStrictEqual([
      "gated: row for table nowhere.list not written — no module in the set owns that table.",
    ]);
  });

  it("refuses a table whose file a module also ships", () => {
    const clash = moduleOf(
      {
        dependsOn: ["email"],
        files: [{ path: "files/p.ts", target: "@web/providers.generated.ts" }],
        name: "clash",
      },
      { "files/p.ts": "x\n" }
    );
    expect(() => renderOf(payloadOf([owner, clash]), ["clash"])).toThrow(
      RefusalError
    );
  });
});

/** A seeded Fisher-Yates shuffle, so a failure reproduces. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

describe("render of a shuffled module list", () => {
  let payload: Payload;
  let requested: string[];

  beforeAll(async () => {
    const presets = JSON.parse(
      await readFile(join(REPO_ROOT, "scripts/play-presets.json"), "utf-8")
    ) as { full: { modules: string[] } };
    requested = [...presets.full.modules, "database-postgres"];
    payload = await loadPayload({
      env: { [REGISTRY_ENV]: MODULES_DIR },
      ref: "local",
      requested,
    });
  }, 60_000);

  it("gives the same bytes for the full preset in any order", () => {
    const sorted = renderOf(payload, requested.toSorted());
    expect(sorted.files.size).toBeGreaterThan(500);
    // The closure of the set, shuffled, from a payload whose map holds the modules in
    // reverse, so neither input order can leak into the result.
    const reversed: Payload = {
      ...payload,
      modules: new Map([...payload.modules].toReversed()),
    };
    for (const seed of [1, 7, 42]) {
      const result = renderOf(reversed, shuffled(sorted.order, seed));
      expect(result.order).toStrictEqual(sorted.order);
      expect([...result.files.keys()]).toStrictEqual([...sorted.files.keys()]);
      // One comparison: the paths whose file differs in content, class, module or source.
      const differing = [...sorted.files]
        .filter(([path, file]) => {
          const other = result.files.get(path);
          return (
            other?.content !== file.content ||
            other.class !== file.class ||
            other.module !== file.module ||
            other.from !== file.from
          );
        })
        .map(([path]) => path);
      expect(differing).toStrictEqual([]);
    }
    // Three renders of the whole preset, under the full suite's load and coverage.
  }, 60_000);
});
