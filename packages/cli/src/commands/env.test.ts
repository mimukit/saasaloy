import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_REFUSED } from "../lib/exit.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, renderPending, runEnv, writeAnswers } from "./env.js";

// `env` is driven here through a real project on disk and a local registry, which keeps
// it offline. The prompt loop itself needs a terminal no test process has, so the run
// under test is the non-interactive one — the same path `--check` takes — and the write
// half is driven directly through `writeAnswers`. Between them they pin what the command
// promises: one target file, that a set value is never touched, and that a target git
// would commit stops the run before a single prompt.

/** The one file every answer lands in. */
const LOCAL = "packages/env/.env";

const ORIGINAL_CWD = process.cwd();
const USAGE_LINE = "saasaloy env [--check]";

/** The env stanza of the base template's `_gitignore`, which is what makes writing safe. */
const GITIGNORE = [
  ".env",
  ".env.*",
  "!.env.example",
  ".dev.vars",
  ".dev.vars.*",
  "!.dev.vars.example",
].join("\n");

const PUBLIC_DESCRIPTION = "Base URL of the API this app talks to.";
const SECRET_DESCRIPTION = "Server-side API key for Plunk.";

let project: string;
let registry: string;

async function put(rel: string, content: string): Promise<void> {
  const abs = join(project, ...rel.split("/"));
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

async function readProject(rel: string): Promise<string> {
  return readFile(join(project, ...rel.split("/")), "utf-8");
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "saasaloy-env-"));
  registry = await mkdtemp(join(tmpdir(), "saasaloy-env-reg-"));

  await mkdir(join(project, ".git"), { recursive: true });
  await put(".gitignore", GITIGNORE);
  await put("package.json", "{}");
  await put(
    "saasaloy.json",
    JSON.stringify({
      aliases: {
        "@api": "apps/api/src",
        "@email": "packages/email/src",
        "@web": "apps/web/src",
      },
      base: "web",
      installed: ["waitlist", "email-plunk"],
    })
  );
  for (const workspace of ["apps/api", "apps/web", "packages/email"]) {
    await put(`${workspace}/package.json`, "{}");
  }
  // Both apps carry a wrangler config; only the api workspace is the Worker.
  await put("apps/api/wrangler.jsonc", "{}");
  await put("apps/web/wrangler.jsonc", "{}");
  await put(
    ".saasaloy/manifest.json",
    JSON.stringify({
      links: {},
      managed: {
        "apps/api/src/routes/waitlist.ts": {
          hash: "a".repeat(64),
          module: "waitlist",
        },
        "apps/web/src/components/WaitlistForm.tsx": {
          hash: "b".repeat(64),
          module: "waitlist",
        },
        "packages/email/src/providers/plunk.ts": {
          hash: "c".repeat(64),
          module: "email-plunk",
        },
      },
      patches: [],
      removeWarnings: {},
    })
  );

  const descriptors = {
    "email-plunk": {
      devVars: { PLUNK_API_KEY: "dev-key" },
      envVars: { PLUNK_API_KEY: SECRET_DESCRIPTION },
      name: "email-plunk",
      type: "saasaloy:capability",
    },
    waitlist: {
      envVars: { PUBLIC_API_URL: PUBLIC_DESCRIPTION },
      name: "waitlist",
      type: "saasaloy:feature",
    },
  };
  for (const [name, item] of Object.entries(descriptors)) {
    await mkdir(join(registry, name), { recursive: true });
    await writeFile(
      join(registry, name, "registry-item.json"),
      JSON.stringify(item),
      "utf-8"
    );
  }

  process.env[REGISTRY_ENV] = registry;
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  delete process.env[REGISTRY_ENV];
  await rm(project, { force: true, recursive: true });
  await rm(registry, { force: true, recursive: true });
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
});

/** `runEnv` with stdout captured, so the clack rail can be read back. */
async function run(args: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(stripAnsi(String(chunk)));
    return true;
  };
  try {
    return { code: await runEnv(args), out: chunks.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe(parseArgs, () => {
  it("reads --check", () => {
    expect(parseArgs(["--check"])).toStrictEqual({ check: true, unknown: [] });
  });

  it("reports an unknown flag and a stray positional", () => {
    expect(parseArgs(["--nope", "waitlist"]).unknown).toStrictEqual([
      "--nope",
      "waitlist",
    ]);
  });
});

describe(renderPending, () => {
  const declaration = {
    description: PUBLIC_DESCRIPTION,
    module: "waitlist",
    name: "PUBLIC_API_URL",
  };

  it("names the variable and the module that declared it", () => {
    const out = stripAnsi(renderPending([{ declaration }]).join("\n"));

    expect(out).toContain("PUBLIC_API_URL");
    expect(out).toContain("declared by waitlist");
  });
});

describe(runEnv, () => {
  it("refuses an unknown flag and quotes the usage line", async () => {
    const { code, out } = await run(["--nope"]);

    expect(code).toBe(EXIT_REFUSED);
    expect(out).toContain("--nope");
    expect(out).toContain(USAGE_LINE);
  });

  it("reports every missing variable without prompting", async () => {
    const { code, out } = await run(["--check"]);

    expect(code).toBe(EXIT_REFUSED);
    expect(out).toContain("PUBLIC_API_URL");
    expect(out).toContain("PLUNK_API_KEY");
    expect(out).toContain("2 variables still unset");
  });

  it("prints the production secrets as commands and runs nothing", async () => {
    const { out } = await run(["--check"]);

    expect(out).toContain("wrangler secret put PLUNK_API_KEY");
    // A public value is bundled at build time; there is no secret to put.
    expect(out).not.toContain("wrangler secret put PUBLIC_API_URL");
    expect(out).toContain("Printed, never run");
  });

  it("treats a set value as answered and exits 0 once nothing is left", async () => {
    await put(
      LOCAL,
      "PUBLIC_API_URL=https://api.example.com\nPLUNK_API_KEY=keep-me\n"
    );

    const { code, out } = await run(["--check"]);

    expect(code).toBe(EXIT_OK);
    expect(out).toContain("Every declared variable is set");
    await expect(readProject(LOCAL)).resolves.toContain(
      "PLUNK_API_KEY=keep-me"
    );
  });

  it("treats a blank value as unset", async () => {
    await put(LOCAL, "PLUNK_API_KEY=\n");

    const { code, out } = await run(["--check"]);

    expect(code).toBe(EXIT_REFUSED);
    expect(out).toContain("PLUNK_API_KEY");
  });

  it("refuses when the target file is not gitignored, and writes nothing", async () => {
    await put(".gitignore", "node_modules\n");

    const { code, out } = await run(["--check"]);

    expect(code).toBe(EXIT_REFUSED);
    expect(out).toContain(LOCAL);
    expect(out).toContain("isn't gitignored");
    await expect(readProject(LOCAL)).rejects.toThrow("ENOENT");
  });

  it("refuses when the project is not a git repository at all", async () => {
    await rm(join(project, ".git"), { force: true, recursive: true });

    const { code, out } = await run([]);

    expect(code).toBe(EXIT_REFUSED);
    expect(out).toContain("isn't gitignored");
  });

  it("says so when no installed module declares a variable", async () => {
    await put(
      "saasaloy.json",
      JSON.stringify({ aliases: {}, base: "web", installed: [] })
    );

    const { code, out } = await run(["--check"]);

    expect(code).toBe(EXIT_OK);
    expect(out).toContain("No module declares an environment variable");
  });

  it("asks once for a variable two modules declare", async () => {
    await writeFile(
      join(registry, "email-plunk", "registry-item.json"),
      JSON.stringify({
        envVars: { PUBLIC_API_URL: "A second module's wording." },
        name: "email-plunk",
        type: "saasaloy:capability",
      }),
      "utf-8"
    );

    const { out } = await run(["--check"]);

    expect(out).toContain("1 variable still unset");
    expect(out).toContain("declared by waitlist");
  });
});

describe(writeAnswers, () => {
  it("appends every answer to the one local value file", async () => {
    await put(LOCAL, "# existing\nKEEP_ME=yes\n");

    const written = await writeAnswers(
      project,
      [
        ["PLUNK_API_KEY", "live-key"],
        ["PUBLIC_API_URL", "https://api.example.com"],
      ],
      "# existing\nKEEP_ME=yes\n"
    );

    expect(written).toBe(2);
    await expect(readProject(LOCAL)).resolves.toBe(
      "# existing\nKEEP_ME=yes\nPLUNK_API_KEY=live-key\nPUBLIC_API_URL=https://api.example.com\n"
    );
  });

  it("creates the file when there was none", async () => {
    await expect(writeAnswers(project, [["PLUNK_API_KEY", "k"]])).resolves.toBe(
      1
    );
    await expect(readProject(LOCAL)).resolves.toBe("PLUNK_API_KEY=k\n");
  });

  it("writes nothing when there is nothing to add", async () => {
    await expect(writeAnswers(project, [])).resolves.toBe(0);
    await expect(readProject(LOCAL)).rejects.toThrow("ENOENT");
  });
});
