#!/usr/bin/env node
// saasaloy CLI entrypoint. Bootstrap only: it resolves an exit code and hands it to
// process.exit. Argument dispatch lives in cli.ts and the command registry in
// commands/index.ts, so both can be imported by a test without running the CLI.

import { main } from "./cli.js";
import { exitCodeFor, formatFailure } from "./lib/exit.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    // formatFailure prints the `cause` chain when SAASALOY_DEBUG is set; the chain
    // registry.ts attaches used to stop here and never reach a bug report (#98).
    console.error(formatFailure(error));
    process.exit(exitCodeFor(error));
  }
);
