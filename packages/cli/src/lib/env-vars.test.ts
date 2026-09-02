import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendVars,
  discoverWorkspaces,
  ENV_FILE,
  DEV_VARS_FILE,
  findWranglerWorkspaces,
  isPublicVar,
  isSet,
  productionSecretCommands,
  routeVariable,
  targetFileName,
  workspaceForPath,
  workspacesByModule,
} from "./env-vars.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";

const API = "apps/api";
const WEB = "apps/web";
const ADMIN = "apps/admin";
const DB = "packages/db";

/** The workspaces a base project plus the `api`/`admin` modules ends up with. */
const WORKSPACES = [ADMIN, API, WEB, DB, "packages/ui"];

function route(name: string, candidates: string[], over = {}) {
  return routeVariable({
    apiWorkspace: API,
    baseWorkspace: WEB,
    candidates,
    name,
    wranglerWorkspaces: [ADMIN, API, WEB],
    ...over,
  });
}

describe(isPublicVar, () => {
  it("tests the prefix literally, and case-sensitively", () => {
    expect(isPublicVar("PUBLIC_API_URL")).toBeTruthy();
    expect(isPublicVar("public_api_url")).toBeFalsy();
    expect(isPublicVar("MY_PUBLIC_KEY")).toBeFalsy();
  });
});

describe(targetFileName, () => {
  it("sends a public value to .env and everything else to .dev.vars", () => {
    expect(targetFileName("PUBLIC_API_URL")).toBe(ENV_FILE);
    expect(targetFileName("BETTER_AUTH_SECRET")).toBe(DEV_VARS_FILE);
  });
});

describe(routeVariable, () => {
  it("sends a public value to the one app the module wrote into", () => {
    // `waitlist` ships a component into apps/web and a route into apps/api.
    expect(
      route("PUBLIC_API_URL", [API, WEB, DB, "packages/ui"])
    ).toStrictEqual({ kind: "resolved", workspace: WEB });
  });

  it("falls back to the base app when the module wrote into no app", () => {
    expect(route("PUBLIC_THING", [DB])).toStrictEqual({
      kind: "resolved",
      workspace: WEB,
    });
  });

  it("asks when two apps both fit a public value", () => {
    expect(route("PUBLIC_API_URL", [API, WEB, ADMIN])).toStrictEqual({
      choices: [ADMIN, WEB],
      kind: "ambiguous",
    });
  });

  it("sends a secret to the api workspace, whichever package declared it", () => {
    // `email-plunk` writes only into packages/email; the Worker is what reads the key.
    expect(route("PLUNK_API_KEY", ["packages/email"])).toStrictEqual({
      kind: "resolved",
      workspace: API,
    });
  });

  it("breaks a two-wrangler tie towards the api workspace", () => {
    expect(route("BETTER_AUTH_SECRET", [API, WEB, DB])).toStrictEqual({
      kind: "resolved",
      workspace: API,
    });
  });

  it("asks when the wrangler candidates exclude the api workspace", () => {
    expect(
      route("SOME_SECRET", [ADMIN, WEB], { apiWorkspace: undefined })
    ).toStrictEqual({ choices: [ADMIN, WEB], kind: "ambiguous" });
  });

  it("gives up rather than guessing when there is nothing to go on", () => {
    expect(route("SOME_SECRET", [], { apiWorkspace: undefined })).toStrictEqual(
      { kind: "unknown" }
    );
  });
});

describe(workspaceForPath, () => {
  it("picks the longest workspace containing the path", () => {
    expect(
      workspaceForPath("apps/api/src/routes/x.ts", [...WORKSPACES, "apps"])
    ).toBe(API);
  });

  it("declines a path under no workspace", () => {
    expect(workspaceForPath("README.md", WORKSPACES)).toBeUndefined();
  });
});

describe(workspacesByModule, () => {
  it("groups a module's written files by the workspace they landed in", () => {
    const manifest: Manifest = {
      ...emptyManifest(),
      managed: {
        "README.md": { hash: "x", module: "waitlist" },
        "apps/api/src/routes/waitlist.ts": { hash: "x", module: "waitlist" },
        "apps/web/src/components/WaitlistForm.tsx": {
          hash: "x",
          module: "waitlist",
        },
        "packages/db/src/schema/auth.ts": { hash: "x", module: "auth" },
      },
    };
    expect(workspacesByModule(manifest, WORKSPACES)).toStrictEqual(
      new Map([
        ["waitlist", [API, WEB]],
        ["auth", [DB]],
      ])
    );
  });
});

describe(isSet, () => {
  it("counts a blank value as unset, so `env` offers to fill it", () => {
    expect(isSet({ A: "value" }, "A")).toBeTruthy();
    expect(isSet({ A: "" }, "A")).toBeFalsy();
    expect(isSet({ A: "   " }, "A")).toBeFalsy();
    expect(isSet({}, "A")).toBeFalsy();
  });
});

describe(appendVars, () => {
  it("keeps every existing line and appends the new pairs", () => {
    expect(
      appendVars("# note\nKEEP_ME=yes\n", [
        ["A", "1"],
        ["B", "2"],
      ])
    ).toBe("# note\nKEEP_ME=yes\nA=1\nB=2\n");
  });

  it("adds the missing newline before appending", () => {
    expect(appendVars("KEEP_ME=yes", [["A", "1"]])).toBe("KEEP_ME=yes\nA=1\n");
  });

  it("writes a fresh file when there was none", () => {
    expect(appendVars(undefined, [["A", "1"]])).toBe("A=1\n");
  });

  it("changes nothing when there is nothing to add", () => {
    expect(appendVars("KEEP_ME=yes", [])).toBe("KEEP_ME=yes");
  });
});

describe(productionSecretCommands, () => {
  it("prints one put per secret, grouped by workspace, and skips public values", () => {
    expect(
      productionSecretCommands([
        { name: "PUBLIC_API_URL", workspace: WEB },
        { name: "PLUNK_API_KEY", workspace: API },
        { name: "BETTER_AUTH_SECRET", workspace: API },
      ])
    ).toStrictEqual([
      `# from ${API}`,
      "wrangler secret put BETTER_AUTH_SECRET",
      "wrangler secret put PLUNK_API_KEY",
    ]);
  });

  it("prints nothing when every variable is public", () => {
    expect(
      productionSecretCommands([{ name: "PUBLIC_API_URL", workspace: WEB }])
    ).toStrictEqual([]);
  });
});

describe("workspace discovery", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-env-vars-"));
    for (const dir of [API, WEB, DB]) {
      await mkdir(join(root, ...dir.split("/"), "src"), { recursive: true });
      await writeFile(join(root, ...dir.split("/"), "package.json"), "{}");
    }
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, ...API.split("/"), "wrangler.jsonc"), "{}");
    await writeFile(join(root, ...WEB.split("/"), "wrangler.jsonc"), "{}");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("walks up from each alias to the nearest package.json", async () => {
    await expect(
      discoverWorkspaces(root, {
        "@api": "apps/api/src",
        "@db": "packages/db/src",
        "@ui": "apps/web/src/components/ui",
        "@web": "apps/web/src",
      })
    ).resolves.toStrictEqual([API, WEB, DB]);
  });

  it("leaves the project root out, where no wrangler process looks", async () => {
    await expect(
      discoverWorkspaces(root, { "@nowhere": "docs/guide" })
    ).resolves.toStrictEqual([]);
  });

  it("finds the workspaces holding a wrangler config", async () => {
    await expect(
      findWranglerWorkspaces(root, [API, WEB, DB])
    ).resolves.toStrictEqual([API, WEB]);
  });
});
