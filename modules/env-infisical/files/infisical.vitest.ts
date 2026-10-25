// Tests for the Infisical value source: the auth exchange, the export parse, the folder
// choice, and the one distinction the offline rule turns on.
//
// It ships as `infisical.test.ts` when testing is on, and `pnpm test:modules` runs it in
// place on Vitest in the saasaloy repo. The `infisical` CLI is injected as a plain
// function, so nothing here opens a connection or shells out.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EnvError } from "../error";
import {
  authEnv,
  failure,
  foldersFor,
  parseExport,
  PROJECT_FILE,
  pullFolders,
  readProjectId,
} from "./infisical";
import type { Cli, CliResult } from "./infisical";

describe("infisical.ts", () => {
  const roots: string[] = [];

  afterAll(() => {
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

  describe(readProjectId, () => {
    it("reads the workspace id", () => {
      expect(readProjectId(makeRoot({ workspaceId: "abc" }))).toBe("abc");
    });

    it("says the project is not set up when the file is missing", () => {
      expect(() => readProjectId(makeRoot())).toThrow(
        expect.toSatisfy((error: EnvError) => {
          expect(error).toBeInstanceOf(EnvError);
          expect(error.code).toBe("not_configured");
          return true;
        })
      );
    });

    it("refuses a project file with no workspace id", () => {
      expect(() => readProjectId(makeRoot({}))).toThrow(/no workspaceId/);
    });
  });

  describe(failure, () => {
    it("calls a CLI that could not start unreachable", () => {
      const error = failure(
        { status: null, stdout: "", stderr: "", error: new Error("ENOENT") },
        "export"
      );
      expect(error.code).toBe("unreachable");
      expect(error.retryable).toBeTruthy();
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
      expect(error.code).toBe("denied");
      expect(error.retryable).toBeFalsy();
      expect(error.providerCode).toBe("1");
      expect(error.message).toMatch(/no access/);
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
      expect(error.code).toBe("unreachable");
    });
  });

  describe(parseExport, () => {
    it("reads the key-value pairs", () => {
      const values = parseExport('[{"key":"A","value":"1"},{"key":"B"}]');
      expect([...values]).toStrictEqual([
        ["A", "1"],
        ["B", ""],
      ]);
    });

    it("reads an empty export as no values", () => {
      expect(parseExport("").size).toBe(0);
    });

    it("refuses a response that is not a list", () => {
      expect(() => parseExport('{"A":"1"}')).toThrow(
        expect.toSatisfy((error: EnvError) => {
          expect(error).toBeInstanceOf(EnvError);
          expect(error.code).toBe("invalid_response");
          return true;
        })
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

  describe(authEnv, () => {
    it("leaves the environment alone with no machine identity", () => {
      const calls: string[][] = [];
      const cli: Cli = (args) => {
        calls.push(args);
        return ok("");
      };
      expect(authEnv(cli, { A: "1" })).toStrictEqual({ A: "1" });
      expect(calls).toStrictEqual([]);
    });

    it("exchanges the identity for a token, and keeps the secret out of argv", () => {
      const calls: {
        args: string[];
        env: Record<string, string | undefined>;
      }[] = [];
      const cli: Cli = (args, env) => {
        calls.push({ args, env });
        return ok("tok_123\n");
      };
      const out = authEnv(cli, {
        INFISICAL_CLIENT_ID: "id",
        INFISICAL_CLIENT_SECRET: "shh",
      });

      expect(out.INFISICAL_TOKEN).toBe("tok_123");
      expect(!calls[0]?.args.join(" ").includes("shh")).toBeTruthy();
      expect(calls[0]?.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET).toBe("shh");
    });

    it("fails when the login is refused", () => {
      expect(() =>
        authEnv(refuses, {
          INFISICAL_CLIENT_ID: "id",
          INFISICAL_CLIENT_SECRET: "x",
        })
      ).toThrow(/bad credentials/);
    });
  });

  describe(foldersFor, () => {
    it("takes /shared plus the service's own folder", () => {
      expect(foldersFor(request())).toStrictEqual(["/shared", "/api"]);
    });

    it("takes the folders the project named instead", () => {
      expect(
        foldersFor(request({ INFISICAL_FOLDERS_API: "/a, /b" }))
      ).toStrictEqual(["/a", "/b"]);
    });
  });

  describe(pullFolders, () => {
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

      expect([
        ...pullFolders(["/shared", "/api"], {
          cli,
          env: {},
          projectId: "p",
          environment: "dev",
        }),
      ]).toStrictEqual([
        ["A", "shared"],
        ["B", "api"],
      ]);
    });

    it("stops on the first folder that fails", () => {
      expect(() =>
        pullFolders(["/shared"], {
          cli: refusesExport,
          env: {},
          projectId: "p",
          environment: "dev",
        })
      ).toThrow(/infisical export of dev \/shared failed/);
    });
  });
});
