// Checks that a CLI release pushes its tag before npm publishes it (ADR 0062). The CLI reads
// the default registry at the tag of its own version, so a version on npm whose tag is not
// yet on GitHub refuses every `add`. release-it 21 runs its built-in npm plugin before git,
// and `packages/cli/release-npm-last.js` moves it last.
//
// The test runs release-it itself, in dry-run mode, in a throwaway git repository with a
// local remote. It reads the commands release-it would run and checks their order. The
// fixture config takes the npm plugin's entry from the real `packages/cli/.release-it.js`,
// so a config that drops the plugin fails here too. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "packages", "cli");
const RELEASE_IT = join(
  CLI,
  "node_modules",
  "release-it",
  "bin",
  "release-it.js"
);
const PLUGIN = "./release-npm-last.js";

/** The lines of a dry run that commit, tag, push or publish, in the order they ran. */
function releaseSteps(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      /^[!$] (?:git (?:commit|tag|push)|npm publish)\b/.test(line)
    )
    .map((line) => line.slice(2).split(" ").slice(0, 2).join(" "));
}

describe("the release order", () => {
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
    // The npm options come from the real config, so dropping the plugin there fails here.
    writeFileSync(
      join(work, ".release-it.js"),
      [
        `import real from ${JSON.stringify(join(CLI, ".release-it.js"))};`,
        `const [namespace, options] = real.plugins[${JSON.stringify(PLUGIN)}];`,
        "export default {",
        // release-it fills `${version}`; the string is its placeholder, not a JS template.
        // oxlint-disable-next-line no-template-curly-in-string
        '  git: { requireBranch: "main", tagName: "v${version}" },',
        "  github: { release: false },",
        "  plugins: {",
        `    ${JSON.stringify(join(CLI, PLUGIN))}: [namespace, { ...options, skipChecks: true }],`,
        "  },",
        "};",
        "",
      ].join("\n")
    );
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

  it("commits, tags and pushes before npm publishes", () => {
    assert.deepEqual(releaseSteps(output), [
      "git commit",
      "git tag",
      "git push",
      "npm publish",
    ]);
  });

  it("publishes once, through the plugin, not through the built-in npm plugin too", () => {
    assert.equal(
      releaseSteps(output).filter((step) => step === "npm publish").length,
      1
    );
  });
});
