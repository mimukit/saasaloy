import { spawn } from "node:child_process";
import path from "node:path";
import { devPort } from "@repo/env/dev-port";
import { readEnvFile } from "@repo/env/env-file";

// `pnpm dev` for the email preview: `email dev` on this checkout's port. The preview
// listens on 3003 in the main checkout. In a linked worktree `pnpm dev:ports` writes
// another port as `DEV_PORT` in this workspace's `.env.local`, and this wrapper passes it
// on as `--port`, since `email dev` reads no env file itself.

const file = path.join(import.meta.dirname, "..", ".env.local");
const port = devPort(readEnvFile(file).values.get("DEV_PORT"), 3003, file);

const child = spawn(
  "email",
  ["dev", "--dir", "src/templates", "--port", String(port)],
  {
    cwd: path.join(import.meta.dirname, ".."),
    stdio: "inherit",
    // `email` is a `.cmd` shim on Windows, which only a shell runs.
    shell: process.platform === "win32",
  }
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === null ? 0 : 1);
});
