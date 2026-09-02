import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { runList } from "./list.js";

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
  for (const name of ["api", "database", "waitlist"]) {
    await mkdir(join(registry, name), { recursive: true });
    await writeFile(
      join(registry, name, "registry-item.json"),
      JSON.stringify({ name, type: "saasaloy:feature" }),
      "utf-8"
    );
  }
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
    const { out } = await run(["--installed"]);

    expect(out).toContain("database");
    expect(out).not.toContain("waitlist");
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
