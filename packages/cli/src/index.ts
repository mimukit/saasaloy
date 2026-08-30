#!/usr/bin/env node
// saasaloy CLI entrypoint. Bootstrap only: it resolves an exit code and hands it to
// process.exit. Argument dispatch lives in cli.ts and the command registry in
// commands/index.ts, so both can be imported by a test without running the CLI.

import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
