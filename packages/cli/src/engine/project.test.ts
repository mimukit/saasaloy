import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_DIR_ENV } from "./payload.js";
import type { PayloadFetcher } from "./payload.js";
import { loadSide } from "./project.js";
import type { SideSpec } from "./project.js";

// A side at an older release reads that release's descriptors, which may carry a key the
// schema has since retired. Under `partial`, a module whose descriptor fails the schema
// drops out of the side without an error, so a retired key read strictly there would
// lose the base of every file the module wrote (plan 0117, blocker B1).

let cache: string;

beforeEach(async () => {
  cache = await mkdtemp(join(tmpdir(), "saasaloy-project-cache-"));
});

afterEach(async () => {
  await rm(cache, { force: true, recursive: true });
});

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

/** A release whose `widget` ships a file gated by the retired `onlyWith`. */
const fetcher: PayloadFetcher = async ({ baseDir, modulesDir }) => {
  await write(
    join(baseDir, "package.json"),
    '{ "name": "{{PROJECT_NAME}}" }\n'
  );
  await write(
    join(baseDir, "_saasaloy-base.json"),
    JSON.stringify({ seedFiles: ["package.json"] })
  );
  await write(
    join(modulesDir, "widget", "registry-item.json"),
    JSON.stringify({
      files: [
        {
          onlyWith: "database-postgres",
          path: "files/db.ts",
          target: "@web/db.ts",
        },
      ],
      name: "widget",
      type: "saasaloy:feature",
    })
  );
  await write(join(modulesDir, "widget", "files/db.ts"), "export {};\n");
};

const spec = (version: string): SideSpec => ({
  coordinates: new Map(),
  options: { projectName: "demo", testingMode: "off" },
  partial: true,
  requested: ["widget"],
  version,
});

describe("loadSide at an older release", () => {
  it("keeps a module whose descriptor carries onlyWith, translated", async () => {
    const { side } = await loadSide(spec("0.9.0"), {
      cliVersion: "0.10.0",
      env: { [CACHE_DIR_ENV]: cache },
      fetcher,
    });

    expect(side.requested).toStrictEqual(["widget"]);
    expect(side.payload.modules.get("widget")?.item.files).toStrictEqual([
      {
        path: "files/db.ts",
        target: "@web/db.ts",
        when: { installed: ["database-postgres"] },
      },
    ]);
  });

  it("reads the running CLI's own release strictly, so the module drops out", async () => {
    const { side } = await loadSide(spec("0.10.0"), {
      cliVersion: "0.10.0",
      env: { [CACHE_DIR_ENV]: cache },
      fetcher,
    });

    expect(side.requested).toStrictEqual([]);
    expect(side.payload.modules.has("widget")).toBeFalsy();
  });
});
