#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { readEnvFile } from "./env-file.ts";

// `env-exec <file> -- <command> [args...]`: run a command with a `.env` loaded into its
// environment, so `infra`'s pulumi scripts need no `source infra/.env` first. A variable
// the shell already exports wins over the file.

/** Split `<file> -- <command> [args...]`. */
export function parseExecArgs(args: string[]): {
  file: string;
  command: string;
  commandArgs: string[];
} {
  const [file, separator, command, ...commandArgs] = args;
  if (
    file === undefined ||
    file === "" ||
    separator !== "--" ||
    command === undefined ||
    command === ""
  ) {
    throw new Error("Usage: env-exec <file> -- <command> [args...]");
  }
  return { file, command, commandArgs };
}

/** The file's values under the current environment. */
export function childEnv(
  values: Map<string, string>,
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  return { ...Object.fromEntries(values), ...env };
}

function main(): void {
  const { file, command, commandArgs } = parseExecArgs(process.argv.slice(2));
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) {
    throw new Error(
      `${resolved} does not exist. Run pnpm env:setup to write it.`
    );
  }
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: childEnv(readEnvFile(resolved).values, process.env),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  child.on("error", (error) => {
    process.stderr.write(
      `env-exec: could not run ${command}: ${error.message}\n`
    );
    process.exitCode = 127;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
