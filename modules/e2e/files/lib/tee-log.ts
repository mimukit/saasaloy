import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Runs a dev server and copies its output to a file as well as to this process's own
// stdout and stderr: `node lib/tee-log.ts <log file> <command...>`.
//
// `playwright.config.ts` starts the api through this script, so a spec can read what the
// api printed from `API_LOG` in `lib/project.ts`. A shell `2>&1 | tee` would do the same on
// macOS and Linux, but `tee` is not on Windows, and `prepare.ts` already runs there.
//
// The file is truncated when the server starts, so each run starts with an empty log. The
// script exits with the server's code, and passes a stop signal on to it, so Playwright's
// kill at the end of the run stops the server too.

const [file, ...command] = process.argv.slice(2);
if (file === undefined || command.length === 0) {
  console.error("Usage: node lib/tee-log.ts <log file> <command...>");
  process.exit(2);
}

mkdirSync(path.dirname(file), { recursive: true });
const log = createWriteStream(file, { flags: "w" });

const child = spawn(command.join(" "), {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
  log.write(chunk);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  log.end(() => {
    process.exit(code ?? 1);
  });
});
