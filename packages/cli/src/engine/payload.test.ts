import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefusalError } from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import {
  CACHE_COMPLETE,
  CACHE_DIR_ENV,
  loadPayload,
  payloadCacheDir,
  payloadCacheRoot,
} from "./payload.js";
import type { PayloadFetcher } from "./payload.js";

let cache: string;

beforeEach(async () => {
  cache = await mkdtemp(join(tmpdir(), "saasaloy-payload-cache-"));
});

afterEach(async () => {
  await rm(cache, { force: true, recursive: true });
});

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

/** A fake registry at one ref: a base template and two modules, `app` needing `core`. */
function fakeFetcher(calls: string[]): PayloadFetcher {
  return async ({ baseDir, modulesDir }, { source, ref }) => {
    calls.push(`${source}@${ref}`);
    await write(
      join(baseDir, "package.json"),
      '{ "name": "{{PROJECT_NAME}}" }\n'
    );
    await write(join(baseDir, "_gitignore"), "node_modules\n");
    await write(
      join(baseDir, "_saasaloy-base.json"),
      JSON.stringify({ seedFiles: ["package.json"] })
    );
    for (const [name, dependsOn] of [
      ["core", []],
      ["app", ["core"]],
      ["unused", []],
    ] as const) {
      await write(
        join(modulesDir, name, "registry-item.json"),
        JSON.stringify({
          dependsOn,
          files: [{ path: "files/index.ts", target: "@web/index.ts" }],
          name,
          type: "saasaloy:feature",
        })
      );
      await write(
        join(modulesDir, name, "files/index.ts"),
        `export const ${name} = "${ref}";\n`
      );
    }
  };
}

describe("payload cache location", () => {
  it("prefers SAASALOY_CACHE_DIR, then XDG_CACHE_HOME, then ~/.cache", () => {
    expect(
      payloadCacheRoot({ [CACHE_DIR_ENV]: "/c", XDG_CACHE_HOME: "/x" })
    ).toBe("/c");
    expect(payloadCacheRoot({ XDG_CACHE_HOME: "/x" })).toBe(
      join("/x", "saasaloy", "payload")
    );
    expect(payloadCacheRoot({})).toBe(
      join(homedir(), ".cache", "saasaloy", "payload")
    );
  });

  it("names an entry <source>@<ref> and refuses a path that climbs out", () => {
    expect(
      payloadCacheDir("acme/kit", "v1.0.0", { [CACHE_DIR_ENV]: "/c" })
    ).toBe(join("/c", "acme", "kit@v1.0.0"));
    expect(() =>
      payloadCacheDir("acme/..", "v1", { [CACHE_DIR_ENV]: "/c" })
    ).toThrow(RefusalError);
    expect(() =>
      payloadCacheDir("acme/kit", "feature/x", { [CACHE_DIR_ENV]: "/c" })
    ).toThrow(RefusalError);
  });
});

describe(loadPayload, () => {
  it("fills the user cache on a fetch, and reads it on the next load", async () => {
    const calls: string[] = [];
    const env = { [CACHE_DIR_ENV]: cache };
    const first = await loadPayload({
      env,
      fetcher: fakeFetcher(calls),
      ref: "v1.0.0",
      requested: ["app"],
      source: "acme/kit",
    });
    expect(calls).toStrictEqual(["acme/kit@v1.0.0"]);
    const entry = join(cache, "acme", "kit@v1.0.0");
    await expect(pathExists(join(entry, CACHE_COMPLETE))).resolves.toBeTruthy();
    await expect(
      readFile(join(entry, "modules", "app", "files", "index.ts"), "utf-8")
    ).resolves.toBe('export const app = "v1.0.0";\n');

    // The resolved set only: `unused` stays on disk and out of memory.
    expect([...first.modules.keys()]).toStrictEqual(["app", "core"]);
    expect(first.base.files.get("_gitignore")).toBe("node_modules\n");
    expect(first.base.files.has("_saasaloy-base.json")).toBeFalsy();
    expect(first.base.declaration.seedFiles).toStrictEqual(["package.json"]);

    const refusing: PayloadFetcher = () => {
      throw new Error("the second load must not fetch");
    };
    const second = await loadPayload({
      env,
      fetcher: refusing,
      ref: "v1.0.0",
      requested: ["app"],
      source: "acme/kit",
    });
    expect(second).toStrictEqual(first);
  });

  it("fetches again for another ref", async () => {
    const calls: string[] = [];
    const env = { [CACHE_DIR_ENV]: cache };
    for (const ref of ["v1.0.0", "v2.0.0", "v1.0.0"]) {
      await loadPayload({
        env,
        fetcher: fakeFetcher(calls),
        ref,
        requested: ["core"],
        source: "acme/kit",
      });
    }
    expect(calls).toStrictEqual(["acme/kit@v1.0.0", "acme/kit@v2.0.0"]);
  });

  it("leaves no entry behind when a fetch fails", async () => {
    const failing: PayloadFetcher = async ({ modulesDir }) => {
      await write(join(modulesDir, "half", "registry-item.json"), "{");
      throw new Error("network down");
    };
    await expect(
      loadPayload({
        env: { [CACHE_DIR_ENV]: cache },
        fetcher: failing,
        ref: "v1.0.0",
        requested: ["core"],
        source: "acme/kit",
      })
    ).rejects.toThrow("network down");
    await expect(
      pathExists(join(cache, "acme", "kit@v1.0.0"))
    ).resolves.toBeFalsy();
  });

  it("reads a local checkout from SAASALOY_REGISTRY_DIR and touches no cache", async () => {
    const registry = join(cache, "registry");
    const calls: string[] = [];
    await fakeFetcher(calls)(
      { baseDir: join(cache, "unused-base"), modulesDir: registry },
      { ref: "local", source: "local" }
    );
    const payload = await loadPayload({
      env: { [CACHE_DIR_ENV]: join(cache, "never"), [REGISTRY_ENV]: registry },
      fetcher: () => {
        throw new Error("a local checkout must not fetch");
      },
      ref: "ignored",
      requested: ["app"],
    });
    expect(payload.source).toBe("local");
    expect([...payload.modules.keys()]).toStrictEqual(["app", "core"]);
    // The base comes from the template bundled with this CLI.
    expect(payload.base.files.has("saasaloy.json")).toBeTruthy();
    await expect(pathExists(join(cache, "never"))).resolves.toBeFalsy();
  });
});
