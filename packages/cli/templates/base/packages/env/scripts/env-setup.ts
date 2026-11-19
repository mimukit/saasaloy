#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { selectServices } from "../src/services.ts";
import type { Environment, Service } from "../src/services.ts";
import { projectRoot } from "../src/project-root.ts";
import { setupServices, writeExampleDefaults } from "../src/setup.ts";
import { sources } from "../src/sources.ts";

// `pnpm env:setup [--env dev|prod] [--only <service>]`: write each service's `.env` from
// the selected value source. `dev` writes every dev service; `--env prod --only <service>`
// writes one production file and nothing under `apps/`. A deploy writes no file at all:
// `pnpm deploy:production` loads the production values in memory.
//
// `--example` is for CI only (`pnpm ci:prepare:env`). It writes each dev service's `.env`
// from the defaults in `packages/env/.env.example`, reads no value source and refuses
// nothing: a key with no default is written blank. It writes no `.env.local`.
//
// A dev run ends with `pnpm dev:ports`, which writes this checkout's dev ports and origins
// into each service's `.env.local`. The `.env` files above never hold them.

function readOptions(args: string[]): {
  environment: Environment;
  only?: string;
  example: boolean;
} {
  let environment: Environment = "dev";
  let only: string | undefined;
  let example = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env") {
      const value = args[index + 1];
      if (value !== "dev" && value !== "prod") {
        throw new Error("--env takes dev or prod.");
      }
      environment = value;
      index += 1;
    } else if (arg === "--only") {
      only = args[index + 1];
      if (!only) {
        throw new Error("--only takes a service name.");
      }
      index += 1;
    } else if (arg === "--example") {
      example = true;
    } else {
      throw new Error(
        `Unknown option ${arg}. This command takes --env, --only and --example.`
      );
    }
  }
  if (example && environment !== "dev") {
    throw new Error(
      "--example writes the example's dev defaults. It does not take --env prod."
    );
  }
  return { environment, only, example };
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function setup(
  root: string,
  environment: Environment,
  services: Service[]
): Promise<void> {
  const report = await setupServices({
    root,
    environment,
    services,
    source: sources.select(process.env.ENV_SOURCE),
    processEnv: process.env,
  });

  if (report.kind === "kept") {
    say(`Warning: ${report.reason}`);
    say(
      `Kept ${report.files.join(", ")}: every listed key already has a value.`
    );
  } else {
    for (const service of report.services) {
      say(`${service.created ? "Created" : "Updated"} ${service.file}.`);
      if (service.migrated) {
        say(
          `Carried the values of ${service.file.replace(/\.env$/, ".dev.vars")} across and deleted it. Wrangler loads .env only while no .dev.vars exists.`
        );
      }
      if (service.extraKeys.length > 0) {
        say(
          `Warning: ${service.extraKeys.join(", ")} came from the value source but packages/env/.env.example does not list them for ${service.service}. Add them there, under a "# @services" section that names ${service.service}.`
        );
      }
    }
  }

  if (environment === "dev") {
    const devPorts = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "dev-ports.ts")],
      { cwd: root, stdio: "inherit" }
    );
    if (devPorts.status !== 0) {
      say("pnpm dev:ports failed. Fix the error above and run it again.");
      process.exitCode = 1;
    }
  }
}

try {
  const options = readOptions(process.argv.slice(2));
  const services = selectServices(options.environment, options.only);
  // From this file, not from git: a project made with `init --no-git` has no repository.
  const root = projectRoot(import.meta.dirname);

  if (options.example) {
    for (const service of writeExampleDefaults({ root, services })) {
      say(
        `${service.created ? "Created" : "Updated"} ${service.file} from the example's defaults.`
      );
    }
  } else {
    await setup(root, options.environment, services);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
