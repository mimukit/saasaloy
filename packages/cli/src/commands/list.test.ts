import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { runJson } from "../../test/support/json-run.js";
import type { JsonRun } from "../../test/support/json-run.js";
import { listedModule, runList } from "./list.js";
import type { ListedModule } from "./list.js";

// `list` reads the same registry seam `add`'s picker does, so a local checkout keeps
// these offline. What is worth pinning is the marking: which names carry the installed
// tick, which are filtered out by a flag, and what happens to a module installed here
// that this registry does not offer.

const ORIGINAL_CWD = process.cwd();

let project: string;
let registry: string;

async function writeConfig(installed: string[], base?: string): Promise<void> {
  await writeFile(
    join(project, "saasaloy.json"),
    JSON.stringify({
      aliases: { "@web": "apps/web" },
      installed,
      ...(base === undefined ? {} : { base }),
    }),
    "utf-8"
  );
}

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), "saasaloy-list-"));
  registry = await mkdtemp(join(tmpdir(), "saasaloy-list-reg-"));
  for (const name of ["api", "database"]) {
    await mkdir(join(registry, name), { recursive: true });
    await writeFile(
      join(registry, name, "registry-item.json"),
      JSON.stringify({ name, type: "saasaloy:feature" }),
      "utf-8"
    );
  }
  // One descriptor carries every field `list --json` maps, so the mapping is read off a
  // real `readModule` rather than only the pure helper.
  await mkdir(join(registry, "waitlist", "skills", "saasaloy-waitlist"), {
    recursive: true,
  });
  await writeFile(
    join(registry, "waitlist", "registry-item.json"),
    JSON.stringify({
      agent: { skills: ["skills/saasaloy-waitlist"] },
      conflictsWith: ["api"],
      dependsOn: ["database"],
      description: "A waitlist form.",
      envVars: { PUBLIC_API_URL: "Where the form posts." },
      name: "waitlist",
      needs: ["domain"],
      requiresOneOf: ["api", "database"],
      stage: "validate",
      type: "saasaloy:capability",
    }),
    "utf-8"
  );
  // A directory with no descriptor is not a module and must not be listed.
  await mkdir(join(registry, "not-a-module"), { recursive: true });
  await writeConfig(["database"]);
  process.env[REGISTRY_ENV] = registry;
  process.chdir(project);
});

afterEach(async () => {
  await writeConfig(["database"]);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  delete process.env[REGISTRY_ENV];
  await rm(project, { recursive: true, force: true });
  await rm(registry, { recursive: true, force: true });
});

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  return {
    lines,
    restore() {
      process.stdout.write = originalWrite;
    },
  };
}

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const captured = capture();
  try {
    return { code: await runList(argv), out: captured.lines.join("") };
  } finally {
    captured.restore();
  }
}

describe("runList — argument rejection", () => {
  it("refuses a flag it does not know", async () => {
    const { code, out } = await run(["--instaled"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): --instaled");
  });

  it("refuses a second positional", async () => {
    const { code, out } = await run(["acme/kit", "extra"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): extra");
  });

  it("refuses --installed and --available together", async () => {
    const { code, out } = await run(["--installed", "--available"]);

    expect(code).toBe(2);
    expect(out).toContain("exclude each other");
  });

  it("refuses a malformed coordinate", async () => {
    const { code, out } = await run(["a/b/c/d"]);

    expect(code).toBe(2);
    expect(out).toContain("Malformed coordinate");
  });
});

describe("runList — what it marks", () => {
  it("lists every module the registry offers, ticking the installed ones", async () => {
    const { code, out } = await run([]);

    expect(code).toBe(0);
    expect(out).toContain("database installed");
    expect(out).toContain("waitlist");
    expect(out).toContain("api");
    expect(out).toContain("3 modules · 1 installed");
    // A folder with no descriptor is not a module.
    expect(out).not.toContain("not-a-module");
  });

  it("shows only the installed ones under --installed", async () => {
    const { code, out } = await run(["--installed"]);

    expect(code).toBe(0);
    expect(out).toContain("database installed");
    expect(out).not.toContain("waitlist");
    expect(out).not.toMatch(/\bapi\b/);
    expect(out).toContain("1 module");
  });

  it("shows only the uninstalled ones under --available", async () => {
    const { out } = await run(["--available"]);

    expect(out).toContain("waitlist");
    expect(out).not.toContain("database installed");
  });

  it("names a module installed here that this registry does not offer", async () => {
    await writeConfig(["database", "from-elsewhere"]);

    const { out } = await run([]);

    expect(out).toContain("installed but not in this registry: from-elsewhere");
  });

  it("names the base app as a scaffold rather than a module", async () => {
    await writeConfig(["database"], "web");

    const { out } = await run([]);

    expect(out).toContain("base app: web");
    expect(out).toContain("not a module");
  });

  it("warns that the registry override ignores an explicit owner/repo", async () => {
    const { code, out } = await run(["acme/kit"]);

    expect(code).toBe(0);
    expect(out).toContain("Ignoring source");
  });

  it("reports an empty registry rather than an empty box", async () => {
    const empty = await mkdtemp(join(tmpdir(), "saasaloy-list-empty-"));
    process.env[REGISTRY_ENV] = empty;
    try {
      const { code, out } = await run([]);

      expect(code).toBe(0);
      expect(out).toContain("No modules found in");
      expect(out).toContain("0 modules");
    } finally {
      process.env[REGISTRY_ENV] = registry;
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("refuses a registry directory that does not exist", async () => {
    process.env[REGISTRY_ENV] = join(tmpdir(), "saasaloy-list-missing");
    try {
      const { code, out } = await run([]);

      expect(code).toBe(2);
      expect(out).toContain("does not exist");
    } finally {
      process.env[REGISTRY_ENV] = registry;
    }
  });
});

// `--json` (#223): one document on stdout, the TUI on stderr.
function runListJson(argv: string[]): Promise<JsonRun> {
  return runJson(runList, [...argv, "--json"]);
}

describe("runList --json (#223)", () => {
  it("prints one document with every module and its descriptor fields", async () => {
    const { code, doc, err } = await runListJson([]);

    expect(code).toBe(0);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.registry).toBe(registry);
    const modules = doc.modules as ListedModule[];
    expect(modules.map((m) => m.name).toSorted()).toStrictEqual([
      "api",
      "database",
      "waitlist",
    ]);
    expect(modules.find((m) => m.name === "waitlist")).toStrictEqual({
      conflictsWith: ["api"],
      dependsOn: ["database"],
      description: "A waitlist form.",
      envVars: { PUBLIC_API_URL: "Where the form posts." },
      installed: false,
      name: "waitlist",
      needs: ["domain"],
      requiresOneOf: ["api", "database"],
      skill: "saasaloy-waitlist",
      stage: "validate",
      tier: "capability",
    });
    expect(modules.find((m) => m.name === "database")?.installed).toBeTruthy();
    // The TUI still draws, on stderr.
    expect(err).toContain("saasaloy list");
  });

  it("lists only the installed modules under --installed", async () => {
    const { code, doc } = await runListJson(["--installed"]);

    expect(code).toBe(0);
    expect((doc.modules as ListedModule[]).map((m) => m.name)).toStrictEqual([
      "database",
    ]);
  });

  it("names an installed module this registry does not offer", async () => {
    await writeConfig(["database", "from-elsewhere"], "web");

    const { doc } = await runListJson([]);

    expect(doc.notInRegistry).toStrictEqual(["from-elsewhere"]);
    expect(doc.base).toBe("web");
  });

  it("prints an error document on a refusal, and keeps exit 2", async () => {
    const { code, doc } = await runListJson(["--installed", "--available"]);

    expect(code).toBe(2);
    expect(doc).toMatchObject({
      error: {
        exitCode: 2,
        message: expect.stringContaining("exclude each other"),
      },
      schemaVersion: 1,
    });
  });
});

describe(listedModule, () => {
  it("reads a descriptor with none of the optional fields as nulls and empties", () => {
    expect(
      listedModule({ name: "bare", type: "saasaloy:feature" }, false)
    ).toStrictEqual({
      conflictsWith: [],
      dependsOn: [],
      description: null,
      envVars: {},
      installed: false,
      name: "bare",
      needs: null,
      requiresOneOf: [],
      skill: null,
      stage: null,
      tier: "feature",
    });
  });
});

// The acceptance check for #223: every module this repo ships describes itself, so an
// agent can choose from `list --json` alone.
describe("runList --json against this repo's modules/", () => {
  const MODULES = fileURLToPath(
    new URL("../../../../modules", import.meta.url)
  );

  it("gives every module a description, a stage and a needs list", async () => {
    process.env[REGISTRY_ENV] = MODULES;
    try {
      const { code, doc } = await runListJson([]);

      expect(code).toBe(0);
      const modules = doc.modules as ListedModule[];
      expect(modules.length).toBeGreaterThan(40);
      const incomplete = modules.filter(
        (m) =>
          typeof m.description !== "string" ||
          m.description.trim() === "" ||
          m.stage === null ||
          !Array.isArray(m.needs)
      );
      expect(incomplete.map((m) => m.name)).toStrictEqual([]);
    } finally {
      process.env[REGISTRY_ENV] = registry;
    }
  });
});
