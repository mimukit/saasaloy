// The second agent of the agent-use line (plan 0110 phase 7, issue #348), with the fake
// agent command and no model. Run with `pnpm test:scripts`, or
// `node --test scripts/agent-bench/second-agent.test.ts`.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { cleanEnv, isInside } from "./harness.ts";
import { judgeAgentUse } from "./score.ts";
import { secondAgent, secondAgentMessage } from "./second-agent.ts";

const root = resolve(import.meta.dirname, "../..");
const fake = [process.execPath, join(import.meta.dirname, "fake-agent.ts")];
const SITE = "http://localhost:10000";
const KEY = "sk_bench_0123456789";

describe("secondAgentMessage", () => {
  it("gives the agent the site's address and the key, and nothing about the build", () => {
    const message = secondAgentMessage(SITE, KEY);
    assert.ok(message.includes(SITE));
    assert.ok(message.includes(KEY));
    assert.match(message, /READ BACK: <id>/);
    assert.doesNotMatch(message, /\{\{|saasaloy|\/mcp|localhost:10005/i);
  });
});

describe("cleanEnv", () => {
  it("drops the parent session, the push tokens, the port block and the CLI's registry", () => {
    const env = cleanEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_OAUTH_TOKEN: "keep",
      GITHUB_TOKEN: "ghp_x",
      DEV_PORTS_BLOCK: "3",
      SAASALOY_REGISTRY_DIR: "/r",
      AGENT_AUDIT_KEY: "sk_x",
    });
    assert.deepEqual(env, {
      PATH: "/usr/bin",
      HOME: "/home/u",
      CLAUDE_CODE_OAUTH_TOKEN: "keep",
    });
  });
});

describe("secondAgent with the fake agent", () => {
  const outDir = mkdtempSync(join(tmpdir(), "agent-bench-second-out-"));
  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });
  const start = (extra: NodeJS.ProcessEnv = {}) =>
    secondAgent({
      command: fake,
      env: {
        ...process.env,
        GITHUB_TOKEN: "ghp_must_not_reach_the_agent",
        DEV_PORTS_BLOCK: "7",
        SAASALOY_REGISTRY_DIR: "/must/not/reach",
        ...extra,
      },
      timeoutMs: 60_000,
    })({ site: SITE, key: KEY, outDir });

  it("starts one call in an empty folder outside the repo, with only the address and the key", async () => {
    const run = await start();
    assert.equal(run.code, 0);
    assert.equal(run.timedOut, false);
    const seen = JSON.parse(
      readFileSync(
        join(outDir, "second-agent", "state", "fake-agent.jsonl"),
        "utf-8"
      ).trim()
    ) as {
      turn: number;
      message: string;
      cwd: string;
      block: string | undefined;
      registry: string | undefined;
      githubToken: string | null;
      empty: boolean;
    };
    assert.equal(seen.turn, 1);
    assert.equal(seen.message, secondAgentMessage(SITE, KEY));
    assert.equal(seen.empty, true);
    assert.equal(isInside(root, seen.cwd), false);
    assert.equal(isInside(outDir, seen.cwd), false);
    assert.equal(existsSync(seen.cwd), false, "the work folder is removed");
    assert.equal(seen.block, undefined);
    assert.equal(seen.registry, undefined);
    assert.equal(seen.githubToken, null);
    assert.ok(
      existsSync(join(outDir, "second-agent", "transcript.jsonl")),
      "the transcript is kept in the out folder"
    );
  });

  it("returns the evidence the judge reads: a PASS for a row the scorer finds", async () => {
    const run = await start();
    assert.match(run.reply, /^READ BACK: fake_1$/m);
    const result = judgeAgentUse({
      table: "books",
      run,
      read: { tool: "books_list", rows: [{ id: "fake_1" }] },
    });
    assert.equal(result.verdict, "PASS", result.detail);
    assert.equal(
      judgeAgentUse({
        table: "books",
        run,
        read: { tool: "books_list", rows: [] },
      }).verdict,
      "FAIL"
    );
  });

  it("fails the line when the second agent exits non-zero", async () => {
    const run = await start({ FAKE_AGENT_EXIT: "3" });
    assert.equal(run.code, 3);
    assert.match(
      judgeAgentUse({
        table: "books",
        run,
        read: { tool: "books_list", rows: [{ id: "fake_1" }] },
      }).detail,
      /exited 3/
    );
  });
});
