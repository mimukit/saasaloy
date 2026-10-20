import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvDefault from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion, satisfies } from "./semver.js";
import type { SemVer } from "./semver.js";

// The drift guard between the registry on `main` and the CLIs on npm (#205).
//
// A module change reaches every user the moment it lands, and a CLI change reaches them
// only when the maintainer releases. A descriptor that uses a field no released CLI knows
// is unreadable to everyone until then, and 0.5.2 met the whole registry that way. Two
// rules close the gap, and this file checks both against every release tag:
//
// 1. A descriptor that some released CLI cannot read declares a `requires.saasaloy` range
//    that excludes that CLI, so a CLI that knows the field refuses with an upgrade line,
//    and the CLI built from this tree satisfies the range.
// 2. A schema that differs from the latest release's sits under a `package.json` version
//    ahead of that release, so a floor can name the version that will ship the field.
//
// It reads the released schemas out of git, which needs the tags: CI checks out with
// `fetch-depth: 0` for this file.

const Ajv2020 = AjvDefault as unknown as typeof AjvDefault.default;

const PKG_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = join(PKG_DIR, "../..");
const MODULES_DIR = join(REPO_ROOT, "modules");
const SCHEMA_PATH = "packages/cli/schemas/registry-item.schema.json";

/**
 * CLI behaviour a descriptor can lean on that the schema does not show. A released CLI
 * older than `since` validates such a descriptor and then gets it wrong, so the schema
 * check alone misses it. Add a row when the applier learns something a descriptor opts
 * into by value rather than by a new field.
 */
const BEHAVIOURS: {
  name: string;
  since: string;
  usedBy: (raw: string) => boolean;
}[] = [
  {
    // `resolveTarget` learned `@root` for a repo-root file (#152).
    name: "the @root alias",
    since: "0.6.0",
    usedBy: (raw) => raw.includes('"@root'),
  },
];

interface Release {
  tag: string;
  version: string;
  semver: SemVer;
  validate: ValidateFunction;
  schema: unknown;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
}

function loadReleases(): Release[] {
  const releases: Release[] = [];
  for (const tag of git(["tag", "--list", "v*"]).split("\n")) {
    const version = tag.trim().slice(1);
    const semver = parseVersion(version);
    if (!semver || semver.prerelease.length > 0) {
      continue;
    }
    const schema = JSON.parse(
      git(["show", `${tag.trim()}:${SCHEMA_PATH}`])
    ) as object;
    // Not strict: an old schema may use a keyword the current Ajv would warn about, and
    // the question here is only what that CLI accepted.
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      schema
    );
    releases.push({ schema, semver, tag: tag.trim(), validate, version });
  }
  return releases.toSorted((a, b) => compareVersions(a.semver, b.semver));
}

const releases = loadReleases();
const cliVersion = (
  JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf-8")) as {
    version: string;
  }
).version;
const currentSchema = JSON.parse(
  readFileSync(join(REPO_ROOT, SCHEMA_PATH), "utf-8")
) as unknown;

const modules = readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => {
    try {
      readFileSync(join(MODULES_DIR, name, "registry-item.json"));
      return true;
    } catch {
      return false;
    }
  })
  .toSorted();

/** Why `release` cannot read the descriptor, or `undefined` when it can. */
function unreadableBecause(
  release: Release,
  item: unknown,
  raw: string
): string | undefined {
  if (!release.validate(item)) {
    const first = release.validate.errors?.[0];
    const where = `(root)${first?.instancePath ?? ""}`;
    const property =
      first && "additionalProperty" in first.params
        ? ` "${String(first.params.additionalProperty)}"`
        : "";
    return `its schema rejects it (${where} ${first?.message ?? ""}${property})`;
  }
  for (const behaviour of BEHAVIOURS) {
    const since = parseVersion(behaviour.since);
    if (
      since &&
      compareVersions(release.semver, since) < 0 &&
      behaviour.usedBy(raw)
    ) {
      return `it predates ${behaviour.name} (${behaviour.since})`;
    }
  }
  return undefined;
}

describe("registry floors (#205)", () => {
  it("reads the release tags", () => {
    // An empty list means a shallow clone, and every check below would pass vacuously.
    expect(
      releases.length,
      "no v* tags in this checkout — fetch them (`git fetch --tags`, or `fetch-depth: 0` in CI)"
    ).toBeGreaterThan(0);
  });

  it("bumps package.json when the schema changed since the latest release", () => {
    const latest = releases.at(-1);
    if (
      !latest ||
      JSON.stringify(latest.schema) === JSON.stringify(currentSchema)
    ) {
      return;
    }
    const current = parseVersion(cliVersion);
    expect(
      current && compareVersions(current, latest.semver) > 0,
      `${SCHEMA_PATH} differs from ${latest.tag}, so packages/cli/package.json has to name the release that ships it (it reads ${cliVersion}). Bump it in this PR.`
    ).toBeTruthy();
  });

  it.each(modules)(
    "%s declares a floor every unreadable release fails",
    (name) => {
      const raw = readFileSync(
        join(MODULES_DIR, name, "registry-item.json"),
        "utf-8"
      );
      const item = JSON.parse(raw) as { requires?: { saasaloy?: string } };
      const range = item.requires?.saasaloy;

      // An absent range admits every CLI, this tree's included.
      expect(
        range === undefined || satisfies(cliVersion, range),
        `modules/${name} needs saasaloy ${range}, which the CLI in this tree (${cliVersion}) does not satisfy`
      ).toBeTruthy();

      const admitted: string[] = [];
      for (const release of releases) {
        const why = unreadableBecause(release, item, raw);
        if (why && (range === undefined || satisfies(release.version, range))) {
          admitted.push(`${release.version}: ${why}`);
        }
      }
      expect(
        admitted,
        `modules/${name} has to declare a requires.saasaloy range that excludes these releases`
      ).toStrictEqual([]);
    }
  );
});
