#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { selectServices } from "../src/services.ts";
import type { Environment } from "../src/services.ts";
import { setupServices } from "../src/setup.ts";
import { sources } from "../src/sources.ts";

// `pnpm env:setup [--env dev|prod] [--only <service>]`: write each service's `.env` from
// the selected value source. `dev` writes every dev service; `--env prod --only infra`
// writes one production file and nothing under `apps/`.

function readOptions(args: string[]): {
  environment: Environment;
  only?: string;
} {
  let environment: Environment = "dev";
  let only: string | undefined;
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
    } else {
      throw new Error(
        `Unknown option ${arg}. This command takes --env and --only.`
      );
    }
  }
  return { environment, only };
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

try {
  const options = readOptions(process.argv.slice(2));
  const services = selectServices(options.environment, options.only);
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();

  const report = await setupServices({
    root,
    environment: options.environment,
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
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
