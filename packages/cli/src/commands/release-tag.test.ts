import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import cliPackage from "../../package.json" with { type: "json" };
import { fixtureModule } from "../../test/support/github-fixture.js";
import { startGitRegistry } from "../../test/support/git-registry.js";
import type { GitRegistry } from "../../test/support/git-registry.js";
import { runJson } from "../../test/support/json-run.js";
import { loadLock } from "../lib/lock.js";
import { GITHUB_API_ENV, REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { runAdd } from "./add.js";
import { scaffoldProject } from "./init.js";
import { runList } from "./list.js";

// ADR 0062 end to end: a CLI reads the default registry at its own release tag. The
// registry here is a real git repository with a commit, the annotated tag `v<version>` of
// the CLI under test, and a later commit on `main` that changes `waitlist` and adds
// `late`. It is served through the GitHub endpoints the CLI calls, so the test drives the
// same `RemoteRegistrySource` a user's install does, offline.

const VERSION = cliPackage.version;
const TAG = `v${VERSION}`;
const ORIGINAL_CWD = process.cwd();
const ENV_KEYS = [
  GITHUB_API_ENV,
  "GIGET_GITHUB_URL",
  "GITHUB_TOKEN",
  "GIGET_AUTH",
  "XDG_CACHE_HOME",
  REGISTRY_ENV,
] as const;

let registry: GitRegistry;
let cache: string;
let project: string;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

function waitlistAt(value: number) {
  return {
    ...fixtureModule("waitlist", { dependsOn: ["email"] }),
    "files/waitlist.ts": `export const waitlist = ${value};\n`,
  };
}

beforeAll(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  registry = await startGitRegistry();
  registry.commit("feat: email and waitlist", {
    email: fixtureModule("email"),
    waitlist: waitlistAt(1),
  });
  registry.tag(TAG);
  registry.commit("feat: change waitlist and add late after the release", {
    late: fixtureModule("late"),
    waitlist: waitlistAt(2),
  });
  // giget caches every tarball; a temp cache keeps the developer's own one clean.
  cache = await mkdtemp(join(tmpdir(), "saasaloy-release-tag-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  process.env[GITHUB_API_ENV] = registry.url;
  process.env.GIGET_GITHUB_URL = registry.url;
});

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "saasaloy-release-tag-"));
  await scaffoldProject({
    projectName: "demo",
    target: project,
    testingMode: "off",
  });
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(project, { force: true, recursive: true });
});

afterAll(async () => {
  await registry.close();
  await rm(cache, { force: true, recursive: true });
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function run(
  command: (argv: string[]) => Promise<number>,
  argv: string[]
): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  const sink = (chunk: string | Uint8Array): boolean => {
    chunks.push(stripAnsi(String(chunk)));
    return true;
  };
  process.stdout.write = sink;
  process.stderr.write = sink;
  try {
    return { code: await command(argv), out: chunks.join("") };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
}

function listedNames(doc: Record<string, unknown>): string[] {
  return (doc.modules as { name: string }[]).map((m) => m.name);
}

async function webFile(name: string): Promise<string> {
  return readFile(join(project, "apps", "web", "src", `${name}.ts`), "utf-8");
}

describe("a CLI reads the default registry at its release tag (ADR 0062)", () => {
  it("lists the modules the tag holds, not one merged to main after it", async () => {
    const { code, doc } = await runJson(runList, ["--json"]);

    expect(code).toBe(0);
    expect(listedNames(doc)).toStrictEqual(["email", "waitlist"]);
    expect(doc.registry).toBe(`mimukit/saasaloy@${TAG}`);
  });

  it("lists the module merged after the tag with @main", async () => {
    const { code, doc } = await runJson(runList, ["@main", "--json"]);

    expect(code).toBe(0);
    expect(listedNames(doc)).toStrictEqual(["email", "late", "waitlist"]);
    expect(doc.registry).toBe("mimukit/saasaloy@main");
  });

  it("fetches every module at the tag, and the lock records the tag", async () => {
    const { code } = await run(runAdd, ["waitlist", "--yes"]);

    expect(code).toBe(0);
    // The tag's bytes, not main's.
    await expect(webFile("waitlist")).resolves.toBe(
      "export const waitlist = 1;\n"
    );
    // The default registry moves as one release, so the lock names the tag (plan 0116).
    const lock = await loadLock(project);
    for (const name of ["email", "waitlist"]) {
      expect(lock.modules[name]).toMatchObject({
        ref: TAG,
        resolved: TAG,
        source: "mimukit/saasaloy",
      });
    }
  });

  it("refuses a module merged after the tag, and refuses @main for one module", async () => {
    const atTag = await run(runAdd, ["late", "--yes"]);

    expect(atTag.code).toBe(2);
    expect(atTag.out).toContain("late");

    const atMain = await run(runAdd, ["late@main", "--yes"]);

    expect(atMain.code).toBe(2);
    expect(atMain.out).toContain("moves as one release");
    await expect(
      readFile(join(project, "apps", "web", "src", "late.ts"), "utf-8")
    ).rejects.toThrow("ENOENT");
  });
});

describe("a CLI whose release tag the registry lacks (ADR 0062)", () => {
  let untagged: GitRegistry;

  beforeAll(async () => {
    untagged = await startGitRegistry();
    untagged.commit("feat: email", { email: fixtureModule("email") });
    process.env[GITHUB_API_ENV] = untagged.url;
    process.env.GIGET_GITHUB_URL = untagged.url;
  });

  afterAll(async () => {
    await untagged.close();
    process.env[GITHUB_API_ENV] = registry.url;
    process.env.GIGET_GITHUB_URL = registry.url;
  });

  it("refuses with exit 2 and names @main as the way out, rather than reading main", async () => {
    const { code, doc } = await runJson(runList, ["--json"]);

    expect(code).toBe(2);
    const message = (doc.error as { message: string }).message;
    expect(message).toContain(`has no tag ${TAG} for saasaloy ${VERSION}`);
    expect(message).toContain("saasaloy add <module>@main");
  });

  it("still reads main when @main asks for it", async () => {
    const { code, doc } = await runJson(runList, ["@main", "--json"]);

    expect(code).toBe(0);
    expect(listedNames(doc)).toStrictEqual(["email"]);
  });
});
