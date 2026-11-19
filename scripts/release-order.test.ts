// Checks that a CLI release never publishes from this box, and that the publish waits for a
// tag on GitHub and an approval (ADR 0064, which amends ADR 0062). The CLI reads the default
// registry at the tag of its own version, so a version on npm whose tag is not yet on
// GitHub refuses every `add`.
//
// The first half runs release-it itself, in dry-run mode, in a throwaway git repository with
// a local remote, and reads the commands it would run. The fixture config is the real
// `packages/cli/.release-it.js` with only the parts that need a real repository swapped
// out (the GitHub Release, the preflight hook, the npm registry checks), so a config that
// turns the npm publish back on, or adds a plugin that publishes, fails here.
//
// The second half parses `.github/workflows/publish.yml` and checks that it starts only on
// a `v*` tag push and that its publish job runs only in the `npm` environment, the one with
// the owner as required reviewer. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "packages", "cli");
const RELEASE_IT = join(
  CLI,
  "node_modules",
  "release-it",
  "bin",
  "release-it.js"
);
const PUBLISH_WORKFLOW = join(ROOT, ".github", "workflows", "publish.yml");

/** The lines of a dry run that bump, commit, tag, push or publish, in the order they ran. */
function releaseSteps(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      /^[!$] (?:git (?:commit|tag|push)|npm (?:version|publish))\b/.test(line)
    )
    .map((line) => line.slice(2).split(" ").slice(0, 2).join(" "));
}

describe("the release-it dry run", () => {
  let dir: string;
  let output: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "saasaloy-release-order-"));
    const work = join(dir, "work");
    const remote = join(dir, "remote.git");
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync("git", args, { cwd, stdio: "pipe" });
    };
    git(dir, "init", "--quiet", "--bare", remote);
    git(dir, "init", "--quiet", "--initial-branch=main", work);
    for (const [key, value] of [
      ["user.email", "release@example.test"],
      ["user.name", "release"],
      ["commit.gpgsign", "false"],
      ["tag.gpgsign", "false"],
      // release-it parses the remote as a URL, so the local remote hides behind one.
      [`url.${remote}.insteadOf`, "https://example.test/owner/fixture.git"],
    ] as const) {
      git(work, "config", key, value);
    }
    writeFileSync(
      join(work, "package.json"),
      `${JSON.stringify({ name: "release-order-fixture", version: "1.0.0" })}\n`
    );
    // The real config, with the GitHub Release, the preflight hook and npm's registry
    // checks turned off. Everything else, the npm options and every plugin, is real.
    writeFileSync(
      join(work, ".release-it.js"),
      [
        `import real from ${JSON.stringify(join(CLI, ".release-it.js"))};`,
        "export default {",
        "  ...real,",
        "  github: { ...real.github, release: false },",
        "  hooks: {},",
        "  npm: { ...real.npm, skipChecks: true },",
        "};",
        "",
      ].join("\n")
    );
    writeFileSync(join(work, ".gitignore"), "CHANGELOG.md\n");
    git(work, "add", "--all");
    git(work, "commit", "--quiet", "--message", "feat: one");
    git(work, "tag", "--annotate", "--message", "v1.0.0", "v1.0.0");
    git(
      work,
      "remote",
      "add",
      "origin",
      "https://example.test/owner/fixture.git"
    );
    git(
      work,
      "push",
      "--quiet",
      "--set-upstream",
      "origin",
      "main",
      "--follow-tags"
    );
    writeFileSync(join(work, "a.txt"), "a\n");
    git(work, "add", "a.txt");
    git(work, "commit", "--quiet", "--message", "feat: two");
    git(work, "push", "--quiet");

    const result = spawnSync(
      process.execPath,
      [RELEASE_IT, "1.0.1", "--dry-run", "--ci"],
      { cwd: work, encoding: "utf-8" }
    );
    output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
  });

  after(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("bumps the version, commits, tags and pushes", () => {
    assert.deepEqual(releaseSteps(output), [
      "npm version",
      "git commit",
      "git tag",
      "git push",
    ]);
  });

  it("runs no npm publish", () => {
    assert.doesNotMatch(output, /\bnpm (?:stage )?publish\b/);
  });
});

interface Workflow {
  on?: unknown;
  jobs?: Record<string, { environment?: unknown; permissions?: unknown }>;
}

describe("publish.yml", () => {
  const text = readFileSync(PUBLISH_WORKFLOW, "utf-8");
  const workflow = parse(text) as Workflow;

  it("starts only on a push of a v* tag", () => {
    assert.deepEqual(workflow.on, { push: { tags: ["v*"] } });
  });

  function environmentOf(job: { environment?: unknown }): unknown {
    return typeof job.environment === "object" && job.environment !== null
      ? (job.environment as { name?: unknown }).name
      : job.environment;
  }

  it("gives an OIDC token only to a job in the npm environment", () => {
    const jobs = Object.entries(workflow.jobs ?? {});
    const publishing = jobs.filter(
      ([, job]) =>
        typeof job.permissions === "object" &&
        job.permissions !== null &&
        "id-token" in job.permissions
    );
    assert.equal(publishing.length, 1, "publish.yml needs one publish job");
    for (const [name, job] of publishing) {
      assert.equal(
        environmentOf(job),
        "npm",
        `job ${name} can mint a token outside the npm environment`
      );
      assert.deepEqual(job.permissions, {
        contents: "read",
        "id-token": "write",
      });
    }
    for (const [name, job] of jobs) {
      if (!publishing.some(([other]) => other === name)) {
        assert.deepEqual(
          job.permissions,
          { contents: "read" },
          `job ${name} has more than contents: read`
        );
      }
    }
  });

  it("pins every action to a 40-character commit SHA", () => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(
      (match) => match[1] ?? ""
    );
    assert.ok(uses.length > 0, "publish.yml has no uses: line");
    for (const action of uses) {
      assert.match(action, /@[0-9a-f]{40}$/, action);
    }
  });

  it("publishes with no NPM_TOKEN secret", () => {
    // The parsed workflow, so the header comment may name the secret it does not use.
    assert.doesNotMatch(JSON.stringify(workflow), /NPM_TOKEN|NODE_AUTH_TOKEN/);
  });
});
