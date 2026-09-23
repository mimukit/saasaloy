import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EnvError } from "../sources.ts";
import type { EnvSource, LoadRequest } from "../sources.ts";

// Infisical as a value source for `pnpm env:setup`.
//
// Everything here runs in node tooling, never in a Worker. Values reach a deployed Worker
// as bindings and secrets, exactly as before this module; Infisical fills a file and is
// never in the upload path.
//
// Three rules the plan settled, all about not doing damage when the service is having a
// bad day:
//
//   - Credentials travel in the child's environment, never in argv, so they never reach a
//     process listing. No value is ever printed.
//   - A failure Infisical *answered* with — bad credentials, no access to the folder — is
//     a plain refusal and always fails the run.
//   - A failure it did not answer at all — no CLI, no network, no route to the host — is
//     `unreachable`, and `setupServices` may then keep files that are already complete.

/** The file `infisical init` writes. It names the project and holds no secret. */
export const PROJECT_FILE = ".infisical.json";

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the CLI could not start, e.g. it is not installed. */
  error?: Error;
}

export type Cli = (
  args: string[],
  env: Record<string, string | undefined>
) => CliResult;

/** Run the `infisical` CLI in `root`, where it finds `.infisical.json`. */
export function runInfisical(root: string): Cli {
  return (args, env) => {
    const result = spawnSync("infisical", args, {
      cwd: root,
      env,
      encoding: "utf-8",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };
  };
}

export function readProjectId(root: string): string {
  const file = path.join(root, PROJECT_FILE);
  if (!existsSync(file)) {
    throw new EnvError(
      `${PROJECT_FILE} is missing, so there is no Infisical project to read. Run infisical init in the repository root.`,
      { code: "not_configured" }
    );
  }
  const id: unknown = (
    JSON.parse(readFileSync(file, "utf-8")) as { workspaceId?: unknown }
  ).workspaceId;
  if (typeof id !== "string" || id === "") {
    throw new EnvError(`${PROJECT_FILE} has no workspaceId.`, {
      code: "not_configured",
    });
  }
  return id;
}

/** The last useful line of the CLI's stderr, which carries its `Message:`. */
function reason(result: CliResult): string {
  const lines = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.find((line) => line.startsWith("Message:")) ??
    lines.at(-1) ??
    `exit code ${result.status}`
  );
}

/**
 * Turn a failed CLI run into a normalized error.
 *
 * The CLI prints `Response Code:` whenever the server answered, so its absence means the
 * request never got a reply. That one line is the whole difference between "keep the
 * files you have" and "this credential is wrong, stop".
 */
export function failure(result: CliResult, what: string): EnvError {
  if (result.error) {
    return new EnvError(
      `Could not run the infisical CLI (${result.error.message}). Install it, or unset ENV_SOURCE to use the local source.`,
      { code: "unreachable", cause: result.error }
    );
  }
  const message = `${what} failed: ${reason(result)}`;
  const providerCode = String(result.status ?? "none");
  return /Response Code:/.test(result.stderr)
    ? new EnvError(
        `${message}. Run infisical login, or check the identity's access.`,
        { code: "denied", providerCode }
      )
    : new EnvError(message, { code: "unreachable", providerCode });
}

/**
 * The environment every export runs with. With `INFISICAL_CLIENT_ID` and
 * `INFISICAL_CLIENT_SECRET` set, it logs the machine identity in and carries the token;
 * otherwise the CLI uses the host's own `infisical login`.
 */
export function authEnv(
  cli: Cli,
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const { INFISICAL_CLIENT_ID: id, INFISICAL_CLIENT_SECRET: secret } = env;
  if (!(id && secret)) {
    return env;
  }
  const result = cli(
    ["login", "--method=universal-auth", "--plain", "--silent"],
    {
      ...env,
      INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: id,
      INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: secret,
    }
  );
  const token = result.stdout.trim();
  if (result.error || result.status !== 0 || token === "") {
    throw failure(result, "The machine identity login");
  }
  return { ...env, INFISICAL_TOKEN: token };
}

/** Parse `infisical export --format=json`. */
export function parseExport(stdout: string): Map<string, string> {
  const parsed: unknown = JSON.parse(stdout.trim() || "[]");
  if (!Array.isArray(parsed)) {
    throw new EnvError("infisical export did not return a list.", {
      code: "invalid_response",
    });
  }
  const values = new Map<string, string>();
  for (const item of parsed as { key?: unknown; value?: unknown }[]) {
    if (typeof item.key === "string") {
      values.set(item.key, typeof item.value === "string" ? item.value : "");
    }
  }
  return values;
}

/**
 * The folders a service takes, merged in order. A later folder wins.
 *
 * `/shared` plus one folder named after the service is the convention, so a key two
 * services read is stored once. A service row may name its own folders through
 * `INFISICAL_FOLDERS_<SERVICE>` for a project that organized Infisical differently.
 */
export function foldersFor(request: LoadRequest): string[] {
  const named =
    request.processEnv[
      `INFISICAL_FOLDERS_${request.service.name.toUpperCase()}`
    ];
  return named
    ? named
        .split(",")
        .map((folder) => folder.trim())
        .filter(Boolean)
    : ["/shared", `/${request.service.name}`];
}

/** Export each folder and merge them in order. */
export function pullFolders(
  folders: string[],
  options: {
    cli: Cli;
    env: Record<string, string | undefined>;
    projectId: string;
    environment: string;
  }
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const folder of folders) {
    const result = options.cli(
      [
        "export",
        `--projectId=${options.projectId}`,
        `--env=${options.environment}`,
        `--path=${folder}`,
        "--format=json",
        "--silent",
      ],
      options.env
    );
    if (result.error || result.status !== 0) {
      throw failure(
        result,
        `infisical export of ${options.environment} ${folder}`
      );
    }
    for (const [key, value] of parseExport(result.stdout)) {
      merged.set(key, value);
    }
  }
  return merged;
}

/** The source `ENV_SOURCE=infisical` selects. `cli` is injected so a test can answer for it. */
export function infisical(cli?: (root: string) => Cli): EnvSource {
  const make = cli ?? runInfisical;
  return {
    name: "infisical",
    load: (request) =>
      Promise.resolve(
        pullFolders(foldersFor(request), {
          cli: make(request.root),
          env: authEnv(make(request.root), request.processEnv),
          projectId: readProjectId(request.root),
          environment: request.environment,
        })
      ),
  };
}
