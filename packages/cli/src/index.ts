#!/usr/bin/env node
// saasaloy CLI entrypoint. Bootstrap only: it hands the resolved exit code to
// process.exit. Argument dispatch and the catch for an error that escapes a command live
// in cli.ts, and the command registry in commands/index.ts, so a test can import both
// without running the CLI.

import { runCli } from "./cli.js";

void runCli(process.argv.slice(2)).then((code) => process.exit(code));
