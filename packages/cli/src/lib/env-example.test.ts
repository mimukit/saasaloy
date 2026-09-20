import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLANK_ON_PURPOSE,
  ENV_EXAMPLE,
  isPublicVar,
  parseEnvExample,
  renderEnvExample,
  servicesFor,
  writeEnvExample,
} from "./env-example.js";

describe(isPublicVar, () => {
  it("is the literal prefix, case-sensitive", () => {
    expect(isPublicVar("PUBLIC_API_URL")).toBeTruthy();
    expect(isPublicVar("public_api_url")).toBeFalsy();
  });
});

describe(servicesFor, () => {
  it("takes a per-key override before the default", () => {
    expect(
      servicesFor("PUBLIC_API_URL", {
        default: ["api"],
        PUBLIC_API_URL: ["web", "admin"],
      })
    ).toStrictEqual(["web", "admin"]);
  });

  it("takes the default for a key with no override", () => {
    expect(servicesFor("EMAIL_FROM", { default: ["api"] })).toStrictEqual([
      "api",
    ]);
  });

  it("drops a name that is not a service", () => {
    expect(servicesFor("A", { default: ["api", "nope"] })).toStrictEqual([
      "api",
    ]);
  });

  it("falls back to the PUBLIC_ prefix rule when nothing is declared", () => {
    expect(servicesFor("PUBLIC_API_URL")).toStrictEqual(["web", "admin"]);
    expect(servicesFor("EMAIL_FROM")).toStrictEqual(["api"]);
  });
});

describe(parseEnvExample, () => {
  const text = [
    "# banner",
    "# @services api web",
    "",
    "# what A is",
    "A=one",
    "",
    "# @services infra",
    "B=",
  ].join("\n");

  it("reads each key's value, comment block and section", () => {
    const parsed = parseEnvExample(text);

    expect(parsed.A).toStrictEqual({
      value: "one",
      comment: ["# what A is"],
      services: ["api", "web"],
    });
    expect(parsed.B).toStrictEqual({
      value: "",
      comment: [],
      services: ["infra"],
    });
  });

  it("ends a comment block at a blank line", () => {
    expect(
      parseEnvExample("# @services api\n# note\n\nA=1\n").A?.comment
    ).toStrictEqual([]);
  });
});

describe(renderEnvExample, () => {
  const base = {
    devVars: {},
    envVars: {},
    services: {},
    existing: {},
  };

  it("groups keys under one section line per distinct service set", () => {
    const out = renderEnvExample({
      ...base,
      envVars: { EMAIL_FROM: "Sender.", PUBLIC_API_URL: "Origin." },
      services: { EMAIL_FROM: ["api"], PUBLIC_API_URL: ["web", "admin"] },
    });

    expect(out).toContain("# @services api\n\n# Sender.\nEMAIL_FROM=");
    expect(out).toContain(
      "# @services web admin\n\n# Origin.\nPUBLIC_API_URL="
    );
  });

  it("prints the sections in a stable order", () => {
    const render = () =>
      renderEnvExample({
        ...base,
        envVars: { A: "a", B: "b" },
        services: { A: ["web"], B: ["api"] },
      });

    expect(render()).toBe(render());
  });

  it("lets a typed value win over the descriptor's devVar", () => {
    const out = renderEnvExample({
      ...base,
      devVars: { EMAIL_FROM: "dev@local" },
      envVars: { EMAIL_FROM: "Sender." },
      services: { EMAIL_FROM: ["api"] },
      existing: {
        EMAIL_FROM: { value: "me@x.com", comment: [], services: ["api"] },
      },
    });

    expect(out).toContain("EMAIL_FROM=me@x.com");
  });

  it("takes the devVar when the file has no value yet", () => {
    const out = renderEnvExample({
      ...base,
      devVars: { EMAIL_FROM: "dev@local" },
      envVars: { EMAIL_FROM: "Sender." },
      services: { EMAIL_FROM: ["api"] },
    });

    expect(out).toContain("EMAIL_FROM=dev@local");
  });

  it("keeps a key no installed module declares, with its own comment and section", () => {
    const out = renderEnvExample({
      ...base,
      existing: {
        PUBLIC_SITE_URL: {
          value: "http://localhost:3000",
          comment: ["# the base's own key"],
          services: ["web"],
        },
      },
    });

    expect(out).toContain(
      "# @services web\n\n# the base's own key\nPUBLIC_SITE_URL=http://localhost:3000"
    );
  });

  it("says so when a key has no description and no kept comment", () => {
    const out = renderEnvExample({
      ...base,
      existing: { STRAY: { value: "x", comment: [], services: ["api"] } },
    });

    expect(out).toContain("# Declared outside saasaloy");
  });
});

describe(writeEnvExample, () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-example-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  const read = () => readFile(join(root, ...ENV_EXAMPLE.split("/")), "utf-8");

  it("writes the key list and returns its path", async () => {
    await expect(
      writeEnvExample({
        root,
        devVars: {},
        envVars: { EMAIL_FROM: "Sender." },
        services: { EMAIL_FROM: ["api"] },
      })
    ).resolves.toBe(ENV_EXAMPLE);
    await expect(read()).resolves.toContain("EMAIL_FROM=");
  });

  it("writes no file when there is nothing to declare", async () => {
    await expect(
      writeEnvExample({ root, devVars: {}, envVars: {}, services: {} })
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the rendered content is unchanged", async () => {
    const args = {
      root,
      devVars: {},
      envVars: { EMAIL_FROM: "Sender." },
      services: { EMAIL_FROM: ["api"] as const satisfies string[] },
    };
    await writeEnvExample(args);

    await expect(writeEnvExample(args)).resolves.toBeUndefined();
  });

  it("never reverts a value someone typed", async () => {
    await mkdir(join(root, "packages", "env"), { recursive: true });
    await writeFile(
      join(root, ...ENV_EXAMPLE.split("/")),
      "# @services api\nEMAIL_FROM=me@x.com\n",
      "utf-8"
    );

    await writeEnvExample({
      root,
      devVars: { EMAIL_FROM: "dev@local" },
      envVars: { EMAIL_FROM: "Sender." },
      services: { EMAIL_FROM: ["api"] },
    });

    await expect(read()).resolves.toContain("EMAIL_FROM=me@x.com");
  });
});

describe("blank-on-purpose keys", () => {
  it("marks a key the declaring module calls optional", () => {
    const out = renderEnvExample({
      devVars: {},
      envVars: { CORS_ORIGINS: "Allowed origins." },
      services: { CORS_ORIGINS: ["api"] },
      existing: {},
      optional: ["CORS_ORIGINS"],
    });

    expect(out).toContain(
      `${BLANK_ON_PURPOSE}\n# Allowed origins.\nCORS_ORIGINS=`
    );
  });

  it("leaves a required key unmarked", () => {
    const out = renderEnvExample({
      devVars: {},
      envVars: { EMAIL_FROM: "Sender." },
      services: { EMAIL_FROM: ["api"] },
      existing: {},
      optional: [],
    });

    expect(out).not.toContain(BLANK_ON_PURPOSE);
  });
});
