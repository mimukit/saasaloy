import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_VARS_EXAMPLE,
  devVarsExamplePath,
  parseDevVars,
  renderDevVarsExample,
  writeDevVarsExample,
} from "./dev-vars.js";

const aliases = { "@api": "apps/api/src", "@web": "apps/web/src" };

describe(devVarsExamplePath, () => {
  it("puts the file in the api workspace, beside wrangler.jsonc", () => {
    expect(devVarsExamplePath(aliases)).toBe(`apps/api/${DEV_VARS_EXAMPLE}`);
  });

  it("tolerates a trailing slash on the alias", () => {
    expect(devVarsExamplePath({ "@api": "apps/api/src/" })).toBe(
      `apps/api/${DEV_VARS_EXAMPLE}`
    );
  });

  it("declines when the project has no api workspace", () => {
    expect(devVarsExamplePath({ "@web": "apps/web/src" })).toBeUndefined();
  });
});

describe(parseDevVars, () => {
  it("reads the assignments and drops the comments", () => {
    const values = parseDevVars(
      ["# a comment", "", "FOO=1", "BAR=", "  BAZ = spaced ", "=nokey"].join(
        "\n"
      )
    );
    expect(values).toStrictEqual({ BAR: "", BAZ: " spaced", FOO: "1" });
  });

  it("keeps an `=` inside a value", () => {
    expect(parseDevVars("DATABASE_URL=postgres://u:p@h/db?a=b")).toStrictEqual({
      DATABASE_URL: "postgres://u:p@h/db?a=b",
    });
  });
});

describe(renderDevVarsExample, () => {
  it("writes one commented entry per variable, sorted", () => {
    const text = renderDevVarsExample({
      devVars: {},
      envVars: { ZED: "last one", ALPHA: "first one" },
      existing: {},
    });
    expect(text).toContain("# first one\nALPHA=\n");
    expect(text).toContain("# last one\nZED=\n");
    expect(text.indexOf("ALPHA=")).toBeLessThan(text.indexOf("ZED="));
  });

  it("pre-fills a declared local-dev value", () => {
    const text = renderDevVarsExample({
      devVars: { BETTER_AUTH_URL: "http://localhost:4000" },
      envVars: { BETTER_AUTH_URL: "The API's own origin." },
      existing: {},
    });
    expect(text).toContain("BETTER_AUTH_URL=http://localhost:4000");
  });

  it("keeps a value the project already had, over the declared default", () => {
    const text = renderDevVarsExample({
      devVars: { BETTER_AUTH_URL: "http://localhost:4000" },
      envVars: { BETTER_AUTH_URL: "The API's own origin." },
      existing: { BETTER_AUTH_URL: "http://localhost:8787" },
    });
    expect(text).toContain("BETTER_AUTH_URL=http://localhost:8787");
    expect(text).not.toContain(":4000");
  });

  it("keeps a variable no installed module declares any more", () => {
    const text = renderDevVarsExample({
      devVars: {},
      envVars: {},
      existing: { HAND_ADDED: "yes" },
    });
    expect(text).toContain("HAND_ADDED=yes");
    expect(text).toContain("Declared outside saasaloy");
  });
});

describe(writeDevVarsExample, () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-devvars-"));
    await mkdir(join(root, "apps", "api"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("writes the file and reports the path it wrote", async () => {
    const written = await writeDevVarsExample({
      aliases,
      devVars: { BETTER_AUTH_URL: "http://localhost:4000" },
      envVars: { BETTER_AUTH_URL: "The API's own origin." },
      root,
    });
    expect(written).toBe(`apps/api/${DEV_VARS_EXAMPLE}`);
    const text = await readFile(
      join(root, "apps", "api", DEV_VARS_EXAMPLE),
      "utf-8"
    );
    expect(text).toContain("BETTER_AUTH_URL=http://localhost:4000");
  });

  it("merges a second module's variables without touching the first's value", async () => {
    const file = join(root, "apps", "api", DEV_VARS_EXAMPLE);
    await writeFile(file, "BETTER_AUTH_SECRET=already-mine\n", "utf-8");
    await writeDevVarsExample({
      aliases,
      devVars: {},
      envVars: { EMAIL_FROM: "Default sender address." },
      root,
    });
    const text = await readFile(file, "utf-8");
    expect(text).toContain("BETTER_AUTH_SECRET=already-mine");
    expect(text).toContain("EMAIL_FROM=");
  });

  it("reports nothing when re-run with the same inputs", async () => {
    const args = {
      aliases,
      devVars: {},
      envVars: { EMAIL_FROM: "Default sender address." },
      root,
    };
    await expect(writeDevVarsExample(args)).resolves.toBeDefined();
    await expect(writeDevVarsExample(args)).resolves.toBeUndefined();
  });

  it("writes nothing when the project has no api workspace", async () => {
    const written = await writeDevVarsExample({
      aliases: { "@web": "apps/web/src" },
      devVars: {},
      envVars: { EMAIL_FROM: "Default sender address." },
      root,
    });
    expect(written).toBeUndefined();
  });

  // #98 Phase 1. `resolveWithinRoot` proves only that the path *string* is inside the
  // project; a symlink planted at the target carries the write out of it.
  it("refuses to write through a symlinked target", async () => {
    const outside = await mkdtemp(join(tmpdir(), "saasaloy-devvars-out-"));
    try {
      const secret = join(outside, "stolen.env");
      await writeFile(secret, "UNTOUCHED=1\n", "utf-8");
      await symlink(secret, join(root, "apps", "api", DEV_VARS_EXAMPLE));
      await expect(
        writeDevVarsExample({
          aliases,
          devVars: {},
          envVars: { EMAIL_FROM: "Default sender address." },
          root,
        })
      ).rejects.toThrow(/symlink/i);
      await expect(readFile(secret, "utf-8")).resolves.toBe("UNTOUCHED=1\n");
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("writes nothing when no module declares a variable", async () => {
    await expect(
      writeDevVarsExample({ aliases, devVars: {}, envVars: {}, root })
    ).resolves.toBeUndefined();
  });
});
