import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectFiles } from "../engine/render.js";
import type { PayloadModule } from "../engine/payload.js";
import { RefusalError } from "./exit.js";
import { loadModuleFolder } from "./registry.js";
import { normalizeRetiredKeys } from "./retired-keys.js";
import { resolveTarget } from "./saasaloy-config.js";
import type { RegistryItem } from "./schema.js";
import { validateRegistryItem } from "./schema.js";
import type { WhenContext } from "./when.js";

// A read at an older release translates the retired `onlyWith` into `when.installed`
// (plan 0117, "Old descriptors at an old ref"). A read of the running registry does not,
// and the schema refuses the key there.

describe(normalizeRetiredKeys, () => {
  it("turns onlyWith on a files[] entry into a when.installed gate", () => {
    expect(
      normalizeRetiredKeys({
        files: [{ onlyWith: "pg", path: "files/db.pg.ts", target: "@db/x.ts" }],
        name: "widget",
      })
    ).toStrictEqual({
      files: [
        {
          path: "files/db.pg.ts",
          target: "@db/x.ts",
          when: { installed: ["pg"] },
        },
      ],
      name: "widget",
    });
  });

  it("appends the name to an existing when and keeps its other keys", () => {
    expect(
      normalizeRetiredKeys({
        files: [
          {
            onlyWith: "pg",
            path: "files/a.ts",
            target: "@db/a.ts",
            when: { installed: ["api"], testing: true },
          },
          {
            onlyWith: "pg",
            path: "files/b.ts",
            target: "@db/b.ts",
            when: { installed: ["pg"] },
          },
        ],
      })
    ).toStrictEqual({
      files: [
        {
          path: "files/a.ts",
          target: "@db/a.ts",
          when: { installed: ["api", "pg"], testing: true },
        },
        // Already named: no duplicate.
        { path: "files/b.ts", target: "@db/b.ts", when: { installed: ["pg"] } },
      ],
    });
  });

  it("translates a scaffold's files and leaves the scaffold's other keys", () => {
    expect(
      normalizeRetiredKeys({
        scaffolds: [
          {
            files: [
              { onlyWith: "pg", path: "files/p.pg.ts", target: "src/p.ts" },
              { path: "files/q.ts", target: "src/q.ts" },
            ],
            workspace: "packages/auth",
          },
        ],
      })
    ).toStrictEqual({
      scaffolds: [
        {
          files: [
            {
              path: "files/p.pg.ts",
              target: "src/p.ts",
              when: { installed: ["pg"] },
            },
            { path: "files/q.ts", target: "src/q.ts" },
          ],
          workspace: "packages/auth",
        },
      ],
    });
  });

  it("returns an equal descriptor when no entry carries onlyWith", () => {
    const raw = {
      files: [
        { path: "files/a.ts", target: "@web/a.ts", when: { testing: true } },
      ],
      name: "plain",
      scaffolds: [{ files: [], workspace: "packages/plain" }],
      type: "saasaloy:feature",
    };
    expect(normalizeRetiredKeys(raw)).toStrictEqual(raw);
    expect(normalizeRetiredKeys("not a descriptor")).toBe("not a descriptor");
  });

  it("leaves an entry with a malformed when as written, for the schema to refuse", () => {
    const badWhen = {
      onlyWith: "pg",
      path: "files/a.ts",
      target: "@db/a.ts",
      when: "api",
    };
    const badInstalled = {
      onlyWith: "pg",
      path: "files/b.ts",
      target: "@db/b.ts",
      when: { installed: "auth" },
    };
    const raw = { files: [badWhen, badInstalled], name: "bad" };

    expect(normalizeRetiredKeys(raw)).toStrictEqual(raw);
  });

  it("never changes its input", () => {
    const raw = {
      files: [
        {
          onlyWith: "pg",
          path: "files/a.ts",
          target: "@db/a.ts",
          when: { installed: ["api"] },
        },
      ],
      scaffolds: [
        {
          files: [{ onlyWith: "pg", path: "files/p.ts", target: "src/p.ts" }],
          workspace: "packages/x",
        },
      ],
    };
    const before = structuredClone(raw);
    normalizeRetiredKeys(raw);
    expect(raw).toStrictEqual(before);
  });
});

// The intent of the engine's old "onlyWith reads as a when.installed gate" test: two
// twins on one target, each gated on a driver, and the render keeps the one whose driver
// is in the set.
describe("a translated twin pair in the engine's file selection", () => {
  const item = normalizeRetiredKeys({
    files: [
      { onlyWith: "extra", path: "files/a.ts", target: "@web/a.ts" },
      { onlyWith: "pg", path: "files/db.pg.ts", target: "@web/db.ts" },
      { onlyWith: "sqlite", path: "files/db.sqlite.ts", target: "@web/db.ts" },
    ],
    name: "widget",
    type: "saasaloy:feature",
  }) as RegistryItem;
  const mod: PayloadModule = { files: new Map(), item, name: "widget" };
  const aliases = { "@web": "apps/web/src" };
  const select = (...installed: string[]) =>
    selectFiles(mod, aliases, {
      installed: new Set(["widget", ...installed]),
      testingMode: "off",
    });

  it("drops every gated entry when no gate holds", () => {
    expect([...select().keys()]).toStrictEqual([]);
  });

  it("ships a gated entry once its module is in the set", () => {
    expect(select("extra").get("apps/web/src/a.ts")?.from).toBe("files/a.ts");
  });

  it("picks the twin whose driver is in the set", () => {
    expect(select("pg").get("apps/web/src/db.ts")?.from).toBe("files/db.pg.ts");
    expect(select("sqlite").get("apps/web/src/db.ts")?.from).toBe(
      "files/db.sqlite.ts"
    );
  });
});

// A byte-for-byte copy of `git show v0.9.0:modules/auth/registry-item.json`, the last
// release of the old engine. It carries `onlyWith` on a `files[]` twin pair and on a
// scaffold twin pair.
const OLD_AUTH = fileURLToPath(
  new URL("../../test/fixtures/old-descriptors/v0.9.0/auth/", import.meta.url)
);

interface RawEntry {
  path: string;
  target: string;
  onlyWith?: string;
}

async function rawOldAuth(): Promise<{
  files: RawEntry[];
  scaffolds: { workspace: string; files: RawEntry[] }[];
}> {
  return JSON.parse(
    await readFile(posix.join(OLD_AUTH, "registry-item.json"), "utf-8")
  ) as {
    files: RawEntry[];
    scaffolds: { workspace: string; files: RawEntry[] }[];
  };
}

describe("the v0.9.0 auth descriptor", () => {
  it("fails the current schema as written", async () => {
    await expect(
      validateRegistryItem(await rawOldAuth())
    ).resolves.toMatchObject({ valid: false });
  });

  it("loads at an old ref, and the same load at the current ref refuses it", async () => {
    const old = await loadModuleFolder(OLD_AUTH, "auth", undefined, {
      atOldRef: true,
    });
    expect(old.item.name).toBe("auth");
    expect(JSON.stringify(old.item)).not.toContain("onlyWith");

    await expect(loadModuleFolder(OLD_AUTH, "auth")).rejects.toThrow(
      RefusalError
    );
    await expect(
      loadModuleFolder(OLD_AUTH, "auth", undefined, { atOldRef: false })
    ).rejects.toThrow(RefusalError);
  });

  it("selects the .pg.ts source for each twinned target with database-postgres installed", async () => {
    const raw = await rawOldAuth();
    const aliases: Record<string, string> = {};
    for (const file of raw.files) {
      const alias = file.target.slice(0, file.target.indexOf("/"));
      aliases[alias] = `packages/${alias.slice(1)}/src`;
    }
    // Every target that had twins, and the source the Postgres twin named.
    const twins = new Map<string, string>();
    const note = (target: string, entry: RawEntry): void => {
      if (entry.onlyWith === "database-postgres") {
        twins.set(target, entry.path);
      }
    };
    for (const file of raw.files) {
      note(resolveTarget(aliases, file.target), file);
    }
    for (const scaffold of raw.scaffolds) {
      for (const file of scaffold.files) {
        note(posix.join(scaffold.workspace, file.target), file);
      }
    }
    expect(twins.size).toBe(2);

    const { item } = await loadModuleFolder(OLD_AUTH, "auth", undefined, {
      atOldRef: true,
    });
    const ctx: WhenContext = {
      installed: new Set(["api", "auth", "database", "database-postgres"]),
      testingMode: "off",
    };
    const selected = selectFiles(
      { files: new Map(), item, name: "auth" },
      aliases,
      ctx
    );
    for (const [target, pg] of twins) {
      expect(pg).toMatch(/\.pg\.ts$/);
      expect(selected.get(target)?.from).toBe(pg);
    }
    // The pick is the gate's, not the entry order's: with no driver in the set, no twin
    // ships at all.
    const bare = selectFiles(
      { files: new Map(), item, name: "auth" },
      aliases,
      { ...ctx, installed: new Set(["api", "auth", "database"]) }
    );
    for (const target of twins.keys()) {
      expect(bare.has(target)).toBeFalsy();
    }
    const sources = [...selected.values()].map((file) => file.from);
    expect(
      sources.filter((from) => /\.(sqlite|d1)\.ts$/.test(from))
    ).toStrictEqual([]);
  });
});
