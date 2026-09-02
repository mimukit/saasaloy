import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fixtureModule,
  startGithubFixture,
} from "../../test/support/github-fixture.js";
import type { GithubFixture } from "../../test/support/github-fixture.js";
import { isRefusal } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import { GITHUB_API_ENV, RemoteRegistrySource } from "./registry.js";

// `RemoteRegistrySource` is the path every real user takes, and until #47 it was the one
// registry source with no test at all. These run against a local fixture server rather
// than GitHub: offline, fast, and immune to a rate limit somebody else is spending.

const SHA = "1234567890abcdef1234567890abcdef12345678";
const OTHER_SHA = "fedcba0987654321fedcba0987654321fedcba09";

let fixture: GithubFixture;
let cache: string;
const savedEnv: Record<string, string | undefined> = {};

async function start(
  options: Parameters<typeof startGithubFixture>[0] = {}
): Promise<void> {
  fixture = await startGithubFixture({
    modules: {
      email: fixtureModule("email"),
      waitlist: fixtureModule("waitlist", { dependsOn: ["email"] }),
    },
    sha: SHA,
    shaByRef: { v2: OTHER_SHA },
    ...options,
  });
  process.env[GITHUB_API_ENV] = fixture.url;
  process.env.GIGET_GITHUB_URL = fixture.url;
}

beforeEach(async () => {
  for (const key of ["GITHUB_TOKEN", "GIGET_AUTH", "XDG_CACHE_HOME"]) {
    savedEnv[key] = process.env[key];
  }
  // giget caches every tarball under XDG_CACHE_HOME. Point it at a temp dir so a test
  // run neither reads a stale entry nor leaves one in the developer's real cache.
  cache = await mkdtemp(join(tmpdir(), "saasaloy-giget-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GIGET_AUTH;
});

afterEach(async () => {
  await fixture.close();
  delete process.env[GITHUB_API_ENV];
  delete process.env.GIGET_GITHUB_URL;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(cache, { recursive: true, force: true });
});

function source(ref?: string): RemoteRegistrySource {
  return new RemoteRegistrySource("mimukit", "saasaloy", ref);
}

describe("RemoteRegistrySource — resolving a ref to a commit SHA", () => {
  beforeEach(() => start());

  it("resolves the repo's default branch when no ref is given", async () => {
    const remote = source();

    await expect(remote.resolveSha()).resolves.toBe(SHA);
    expect(fixture.requests).toStrictEqual([
      "/repos/mimukit/saasaloy",
      "/repos/mimukit/saasaloy/commits/main",
    ]);
  });

  it("honours an explicit ref, and never asks for the default branch", async () => {
    const remote = source("v2");

    await expect(remote.resolveSha()).resolves.toBe(OTHER_SHA);
    expect(fixture.requests).toStrictEqual([
      "/repos/mimukit/saasaloy/commits/v2",
    ]);
  });

  it("resolves once and reuses the SHA for every module in one install", async () => {
    const remote = source();
    await remote.readModule("email");
    await remote.readModule("waitlist");
    try {
      const resolves = fixture.requests.filter((path) =>
        path.includes("/commits/")
      );

      expect(resolves).toHaveLength(1);
      expect(
        fixture.requests.filter((path) => path === "/repos/mimukit/saasaloy")
      ).toHaveLength(1);
    } finally {
      await remote.cleanup();
    }
  });

  it("labels itself by coordinate, with and without a ref", () => {
    expect(source().label).toBe("mimukit/saasaloy");
    expect(source("v2").label).toBe("mimukit/saasaloy@v2");
  });
});

describe("RemoteRegistrySource — provenance", () => {
  beforeEach(() => start());

  it("throws when asked before anything resolved a SHA", () => {
    expect(() => source().provenance()).toThrow(
      "provenance() called before the source resolved a commit SHA"
    );
  });

  it("records the source, the ref asked for, and the SHA it resolved to", async () => {
    const remote = source();
    await remote.resolveSha();

    expect(remote.provenance()).toStrictEqual({
      ref: "main",
      resolved: SHA,
      source: "mimukit/saasaloy",
    });
  });

  it("records an explicit ref rather than the branch it stands for", async () => {
    const remote = source("v2");
    await remote.resolveSha();

    expect(remote.provenance()).toMatchObject({
      ref: "v2",
      resolved: OTHER_SHA,
    });
  });
});

describe("RemoteRegistrySource — downloading a module", () => {
  beforeEach(() => start());

  it("extracts the module folder and reads its descriptor", async () => {
    const remote = source();
    try {
      const loaded = await remote.readModule("waitlist");

      expect(loaded.item.name).toBe("waitlist");
      expect(loaded.item.dependsOn).toStrictEqual(["email"]);
      await expect(
        readFile(join(loaded.dir, "files", "waitlist.ts"), "utf-8")
      ).resolves.toContain("waitlist");
    } finally {
      await remote.cleanup();
    }
  });

  it("fetches the tarball at the resolved SHA, not at the ref", async () => {
    const remote = source();
    try {
      await remote.readModule("email");

      expect(fixture.requests).toContain(
        `/repos/mimukit/saasaloy/tarball/${SHA}`
      );
    } finally {
      await remote.cleanup();
    }
  });

  it("cleanup() removes every temp dir it extracted into", async () => {
    const remote = source();
    const first = await remote.readModule("email");
    const second = await remote.readModule("waitlist");
    const parents = [dirname(first.dir), dirname(second.dir)];
    expect(parents[0]).not.toBe(parents[1]);

    await remote.cleanup();

    for (const parent of parents) {
      await expect(pathExists(parent)).resolves.toBeFalsy();
    }
  });

  it("cleanup() is safe to call twice", async () => {
    const remote = source();
    await remote.readModule("email");
    await remote.cleanup();

    await expect(remote.cleanup()).resolves.toBeUndefined();
  });

  it("reports a module the registry does not carry, naming what required it", async () => {
    const remote = source();
    try {
      await expect(remote.readModule("ghost", "waitlist")).rejects.toThrow(
        /Unknown module "ghost" \(required by waitlist\)/
      );
    } finally {
      await remote.cleanup();
    }
  });
});

describe("RemoteRegistrySource — listModules", () => {
  beforeEach(() => start());

  it("reads the module names out of the recursive tree response", async () => {
    await expect(source().listModules()).resolves.toStrictEqual([
      "email",
      "waitlist",
    ]);
  });

  it("asks for the tree at the resolved SHA, recursively", async () => {
    await source().listModules();

    expect(fixture.requests).toContain(
      `/repos/mimukit/saasaloy/git/trees/${SHA}?recursive=1`
    );
  });

  it("ignores paths outside modules/ and folders with no descriptor", async () => {
    const names = await source().listModules();

    expect(names).not.toContain("nested");
    expect(names).not.toContain("README.md");
  });
});

describe("RemoteRegistrySource — the three error paths", () => {
  it("names the rate limit, and how to raise it", async () => {
    await start({
      failure: (path) =>
        path === "/repos/mimukit/saasaloy"
          ? { status: 403, headers: { "x-ratelimit-remaining": "0" } }
          : undefined,
    });

    await expect(source().resolveSha()).rejects.toThrow(
      /rate limit hit for mimukit\/saasaloy\. Set GITHUB_TOKEN to raise it/
    );
  });

  it("takes a 404 as a refusal, not a failure — a retry cannot help", async () => {
    await start({ failure: () => ({ status: 404 }) });

    const caught = await source()
      .resolveSha()
      .catch((error: unknown) => error);

    expect(isRefusal(caught)).toBeTruthy();
    expect((caught as Error).message).toContain("Not found on GitHub");
  });

  it("reports any other API status as a plain failure", async () => {
    await start({ failure: () => ({ status: 500 }) });

    const caught = await source()
      .resolveSha()
      .catch((error: unknown) => error);

    expect(isRefusal(caught)).toBeFalsy();
    expect((caught as Error).message).toContain("GitHub API error 500");
  });

  it("points every network failure at the offline escape hatch", async () => {
    await start({ failure: () => ({ status: 500 }) });

    await expect(source().resolveSha()).rejects.toThrow(
      /Set SAASALOY_REGISTRY_DIR to a local `modules\/` checkout to work offline/
    );
  });

  it("reports a 403 that is not a rate limit as a generic API error", async () => {
    await start({
      failure: () => ({
        status: 403,
        headers: { "x-ratelimit-remaining": "42" },
      }),
    });

    await expect(source().resolveSha()).rejects.toThrow(/GitHub API error 403/);
  });

  it("wraps a failed download with the module name and the offline hint", async () => {
    await start({
      failure: (path) =>
        path.includes("/tarball/") ? { status: 500 } : undefined,
    });
    const remote = source();
    try {
      await expect(remote.readModule("email", "waitlist")).rejects.toThrow(
        /Could not fetch module "email" \(required by waitlist\)/
      );
    } finally {
      await remote.cleanup();
    }
  });

  it("reports an unreachable host rather than hanging", async () => {
    await start();
    await fixture.close();

    await expect(source().resolveSha()).rejects.toThrow(
      /Could not reach GitHub for mimukit\/saasaloy/
    );
    // The fixture is already closed; `close()` is idempotent, so afterEach is a no-op.
  });
});

describe("RemoteRegistrySource — commitSubjects", () => {
  beforeEach(() => start());

  it("has nothing to report when both SHAs are the same", async () => {
    await expect(
      source().commitSubjects("modules/email", SHA, SHA)
    ).resolves.toStrictEqual([]);
  });

  it("degrades to no intent rather than failing when the history is unreachable", async () => {
    await expect(
      source().commitSubjects("modules/email", SHA, OTHER_SHA)
    ).resolves.toStrictEqual([]);
  });
});
