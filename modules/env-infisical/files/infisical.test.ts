// Tests for the Infisical value source: the auth exchange, the export parse, the folder
// choice, and the one distinction the offline rule turns on.
//
// This file is NOT in the descriptor's `files` list, so `add env-infisical` never copies
// it into a user's project — it exists for this repo only. The `infisical` CLI is injected
// as a plain function, so nothing here opens a connection or shells out.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. Shipped payload code keeps the extensionless
// style the rest of the modules use.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { EnvError } from "../sources.ts";
import {
  authEnv,
  failure,
  foldersFor,
  parseExport,
  PROJECT_FILE,
  pullFolders,
  readProjectId,
} from "./infisical.ts";
import type { Cli, CliResult } from "./infisical.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(project?: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "infisical-"));
  roots.push(root);
  if (project !== undefined) {
    writeFileSync(path.join(root, PROJECT_FILE), JSON.stringify(project));
  }
  return root;
}

function ok(stdout: string): CliResult {
  return { status: 0, stdout, stderr: "" };
}

const service = {
  name: "api",
  file: "apps/api/.env",
  environment: "dev" as const,
  omit: [],
};

function request(processEnv: Record<string, string | undefined> = {}) {
  return { root: "/tmp", service, environment: "dev" as const, processEnv };
}

describe(readProjectId.name, () => {
  it("reads the workspace id", () => {
    assert.equal(readProjectId(makeRoot({ workspaceId: "abc" })), "abc");
  });

  it("says the project is not set up when the file is missing", () => {
    assert.throws(
      () => readProjectId(makeRoot()),
      (error: unknown) => {
        assert.ok(error instanceof EnvError);
        assert.equal(error.code, "not_configured");
        return true;
      }
    );
  });

  it("refuses a project file with no workspace id", () => {
    assert.throws(() => readProjectId(makeRoot({})), /no workspaceId/);
  });
});

describe(failure.name, () => {
  it("calls a CLI that could not start unreachable", () => {
    const error = failure(
      { status: null, stdout: "", stderr: "", error: new Error("ENOENT") },
      "export"
    );
    assert.equal(error.code, "unreachable");
    assert.equal(error.retryable, true);
  });

  it("calls a refusal the server answered with denied", () => {
    const error = failure(
      {
        status: 1,
        stdout: "",
        stderr: "Response Code: 403\nMessage: no access",
        error: undefined,
      },
      "export"
    );
    assert.equal(error.code, "denied");
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, "1");
    assert.match(error.message, /no access/);
  });

  it("calls a failure with no reply unreachable", () => {
    const error = failure(
      {
        status: 1,
        stdout: "",
        stderr: "dial tcp: i/o timeout",
        error: undefined,
      },
      "export"
    );
    assert.equal(error.code, "unreachable");
  });
});

describe(parseExport.name, () => {
  it("reads the key-value pairs", () => {
    const values = parseExport('[{"key":"A","value":"1"},{"key":"B"}]');
    assert.deepEqual(
      [...values],
      [
        ["A", "1"],
        ["B", ""],
      ]
    );
  });

  it("reads an empty export as no values", () => {
    assert.equal(parseExport("").size, 0);
  });

  it("refuses a response that is not a list", () => {
    assert.throws(
      () => parseExport('{"A":"1"}'),
      (error: unknown) => {
        assert.ok(error instanceof EnvError);
        assert.equal(error.code, "invalid_response");
        return true;
      }
    );
  });
});

/** A CLI that always refuses, with the server's own reply. */
const refuses: Cli = () => ({
  status: 1,
  stdout: "",
  stderr: "Response Code: 401\nMessage: bad credentials",
  error: undefined,
});

/** A CLI that refuses an export, with no message body. */
const refusesExport: Cli = () => ({
  status: 1,
  stdout: "",
  stderr: "Response Code: 403",
  error: undefined,
});

describe(authEnv.name, () => {
  it("leaves the environment alone with no machine identity", () => {
    const calls: string[][] = [];
    const cli: Cli = (args) => {
      calls.push(args);
      return ok("");
    };
    assert.deepEqual(authEnv(cli, { A: "1" }), { A: "1" });
    assert.deepEqual(calls, []);
  });

  it("exchanges the identity for a token, and keeps the secret out of argv", () => {
    const calls: { args: string[]; env: Record<string, string | undefined> }[] =
      [];
    const cli: Cli = (args, env) => {
      calls.push({ args, env });
      return ok("tok_123\n");
    };
    const out = authEnv(cli, {
      INFISICAL_CLIENT_ID: "id",
      INFISICAL_CLIENT_SECRET: "shh",
    });

    assert.equal(out.INFISICAL_TOKEN, "tok_123");
    assert.ok(!calls[0]?.args.join(" ").includes("shh"));
    assert.equal(calls[0]?.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET, "shh");
  });

  it("fails when the login is refused", () => {
    assert.throws(
      () =>
        authEnv(refuses, {
          INFISICAL_CLIENT_ID: "id",
          INFISICAL_CLIENT_SECRET: "x",
        }),
      /bad credentials/
    );
  });
});

describe(foldersFor.name, () => {
  it("takes /shared plus the service's own folder", () => {
    assert.deepEqual(foldersFor(request()), ["/shared", "/api"]);
  });

  it("takes the folders the project named instead", () => {
    assert.deepEqual(foldersFor(request({ INFISICAL_FOLDERS_API: "/a, /b" })), [
      "/a",
      "/b",
    ]);
  });
});

describe(pullFolders.name, () => {
  it("merges the folders in order, so a later one wins", () => {
    const answers = new Map([
      [
        "/shared",
        '[{"key":"A","value":"shared"},{"key":"B","value":"shared"}]',
      ],
      ["/api", '[{"key":"B","value":"api"}]'],
    ]);
    const cli: Cli = (args) => {
      const folder = args
        .find((arg) => arg.startsWith("--path="))
        ?.slice("--path=".length);
      return ok(answers.get(folder ?? "") ?? "[]");
    };

    assert.deepEqual(
      [
        ...pullFolders(["/shared", "/api"], {
          cli,
          env: {},
          projectId: "p",
          environment: "dev",
        }),
      ],
      [
        ["A", "shared"],
        ["B", "api"],
      ]
    );
  });

  it("stops on the first folder that fails", () => {
    assert.throws(
      () =>
        pullFolders(["/shared"], {
          cli: refusesExport,
          env: {},
          projectId: "p",
          environment: "dev",
        }),
      /infisical export of dev \/shared failed/
    );
  });
});
