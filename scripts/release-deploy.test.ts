// Tests for the release deploy hook (plan 0114, Phase 6): the command it runs, the rerun
// text on failure, and the `.release-it.js` wiring. No test deploys: `deploy` takes a fake
// runner, and the config check only reads the file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deploy, deployCommand, rerunCommand } from "./release-deploy.ts";
import {
  deployCommands,
  headProblem,
  runAll,
} from "../apps/web/scripts/deploy-release.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("deploy", () => {
  it("runs the web workspace's deploy:release with the tag", () => {
    const ran: string[][] = [];
    const logs: string[] = [];
    const code = deploy(
      "v0.9.0",
      (command) => {
        ran.push(command);
        return 0;
      },
      (line) => {
        logs.push(line);
      }
    );
    assert.equal(code, 0);
    assert.deepEqual(ran, [
      [
        "pnpm",
        "--filter",
        "@saasaloy/web",
        "run",
        "deploy:release",
        "--",
        "v0.9.0",
      ],
    ]);
    assert.deepEqual(logs, []);
  });

  it("prints the rerun command and exits non-zero when the command fails", () => {
    const logs: string[] = [];
    const code = deploy(
      "v0.9.0",
      () => 7,
      (line) => {
        logs.push(line);
      }
    );
    assert.equal(code, 7);
    assert.match(logs.join("\n"), /failed \(exit 7\)/);
    assert.ok(
      logs
        .join("\n")
        .includes(
          "git checkout v0.9.0 && pnpm --filter @saasaloy/web deploy:production"
        )
    );
  });

  it("never turns a failure into exit 0, even from a fake exit of 2", () => {
    assert.equal(
      deploy(
        "v0.9.0",
        () => 2,
        () => {}
      ),
      1
    );
  });

  it("refuses a tag that is not v<semver> and runs nothing", () => {
    let ran = false;
    const code = deploy(
      "main",
      () => {
        ran = true;
        return 0;
      },
      () => {}
    );
    assert.equal(code, 2);
    assert.equal(ran, false);
  });

  it("builds the same rerun text the plan names", () => {
    assert.equal(
      rerunCommand("v1.2.3"),
      "git checkout v1.2.3 && pnpm --filter @saasaloy/web deploy:production"
    );
    assert.equal(deployCommand("v1.2.3").at(-1), "v1.2.3");
  });
});

describe("the web deploy:release script", () => {
  it("builds, then deploys with the tag and the message", () => {
    assert.deepEqual(deployCommands("v0.9.0", false), [
      ["pnpm", "run", "build"],
      ["wrangler", "deploy", "--tag", "v0.9.0", "--message", "saasaloy v0.9.0"],
    ]);
  });

  it("adds --dry-run for wrangler only", () => {
    assert.deepEqual(deployCommands("v0.9.0", true)[1]?.slice(-1), [
      "--dry-run",
    ]);
  });

  it("rejects a tag that is not v<semver>", () => {
    assert.throws(() => deployCommands("0.9.0", false), /not a release tag/);
  });

  it("refuses a real deploy when HEAD is not at the tag", () => {
    assert.equal(headProblem("v0.9.0", ["v0.9.0"]), undefined);
    assert.match(
      headProblem("v0.9.0", []) ?? "",
      /HEAD is not at v0\.9\.0.*git checkout v0\.9\.0/
    );
    assert.match(headProblem("v0.9.0", ["v0.8.0"]) ?? "", /not at v0\.9\.0/);
  });

  it("stops at the first failing command", () => {
    const ran: string[] = [];
    const code = runAll(deployCommands("v0.9.0", false), (command) => {
      ran.push(command[0]);
      return 3;
    });
    assert.equal(code, 3);
    assert.deepEqual(ran, ["pnpm"]);
  });
});

describe("packages/cli/.release-it.js", () => {
  it("runs the release deploy after the release, beside the preflight", async () => {
    const config = (await import(`${ROOT}packages/cli/.release-it.js`)) as {
      default: { hooks: Record<string, string[]> };
    };
    assert.deepEqual(config.default.hooks["before:init"], [
      "pnpm -w run release:preflight",
    ]);
    // release-it fills `${version}`; the string here is its placeholder.
    assert.deepEqual(config.default.hooks["after:release"], [
      // oxlint-disable-next-line no-template-curly-in-string
      "pnpm -w run release:deploy v${version}",
    ]);
  });
});
