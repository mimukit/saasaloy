// Codex adapter for the benchmark contract documented in ./claude.ts.
// Keep raw events and add a final result for the interview parser.
// Codex reports no dollar cost. Leave that field absent.
// Resume only the thread recorded in AGENT_BENCH_STATE.
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const state = process.env.AGENT_BENCH_STATE;
if (!state) {
  throw new Error("AGENT_BENCH_STATE is required");
}
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}
const message = Buffer.concat(chunks).toString("utf-8").trim();
if (!message) {
  throw new Error("a message on stdin is required");
}
const sessionFile = join(state, "codex-session");
// Do not load this machine's AGENTS.md, skills, plugins, or hooks into the product.
// Use the existing login only for this call, with private file permissions.
const home = join(state, "codex-home");
mkdirSync(home, { recursive: true, mode: 0o700 });
const source = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const auth = join(home, "auth.json");
process.once("exit", () => {
  rmSync(auth, { force: true });
});
process.once("SIGTERM", () => {
  process.exit(143);
});
process.once("SIGINT", () => {
  process.exit(130);
});
if (existsSync(join(source, "auth.json"))) {
  copyFileSync(join(source, "auth.json"), auth);
  chmodSync(auth, 0o600);
}
const resume = Number(process.env.AGENT_BENCH_TURN ?? "1") > 1;
const args = [
  "-c",
  'approval_policy="on-request"',
  "-c",
  'approvals_reviewer="auto_review"',
  "-c",
  'sandbox_mode="workspace-write"',
  "exec",
  ...(resume ? ["resume", readFileSync(sessionFile, "utf-8").trim()] : []),
  "--ignore-user-config",
  "--skip-git-repo-check",
  "--json",
  "--model",
  "gpt-6.2-sol",
  ...process.argv.slice(2),
  "-",
];
const child = spawn("codex", args, {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["pipe", "pipe", "inherit"],
});
const completed = new Promise<number>((done) => {
  child.on("error", () => {
    done(127);
  });
  child.on("exit", (code) => {
    done(code ?? 1);
  });
});
child.stdin.on("error", () => {
  // The exit code reports an early child failure.
});
child.stdin.end(message);
let reply = "";
let failed = false;
for await (const line of createInterface({ input: child.stdout })) {
  process.stdout.write(`${line}\n`);
  let event: {
    type?: string;
    thread_id?: string;
    item?: { type?: string; text?: string };
  };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    continue;
  }
  if (event.type === "thread.started" && event.thread_id) {
    writeFileSync(sessionFile, event.thread_id);
  }
  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    reply = event.item.text ?? "";
  }
  if (event.type === "turn.failed") {
    failed = true;
  }
}
const code = await completed;
process.stdout.write(`${JSON.stringify({ type: "result", result: reply })}\n`);
process.exit(failed ? 1 : code);
