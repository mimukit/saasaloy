import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import { pathExists } from "../lib/fs-utils.js";
import { copyTemplate } from "../lib/scaffold.js";

// `saasaloy init <name>` — scaffold the near-inert base (Astro landing + @repo/ui
// + @repo/config) and print next steps. The base ships committed AGENTS.md/CLAUDE.md
// (fixed common rules); nothing is generated. Churny modules (api, database, auth,
// admin, features) are added later via `saasaloy add`, which copies their skills in.

// Bundled at <pkg>/templates/base; at runtime import.meta.url is <pkg>/dist/index.js.
const TEMPLATE_DIR = fileURLToPath(new URL("../templates/base", import.meta.url));

// wrangler and npm package names share this constraint.
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Run `pnpm install` in the scaffolded project. Output is swallowed so only the
// caller's spinner shows; stderr is retained so a failure can be surfaced. Never
// throws — failures come back as { ok: false } so init can carry on regardless.
function runPnpmInstall(cwd: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("pnpm", ["install"], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      // e.g. pnpm not on PATH.
      resolvePromise({ ok: false, message: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ ok: true });
      } else {
        resolvePromise({
          ok: false,
          message: stderr.trim() || `pnpm install exited with code ${code ?? "unknown"}`,
        });
      }
    });
  });
}

export async function runInit(argv: string[]): Promise<number> {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const force = argv.includes("--force");
  let nameArg = positional[0];

  intro(pc.bgCyan(pc.black(" saasaloy init ")));

  // No name given — ask for it rather than erroring out.
  if (!nameArg) {
    const answer = await text({
      message: "Project name?",
      placeholder: "my-app (use `.` for the current directory)",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Enter a project name (or `.` for the current directory).";
        // Mirror the arg path: name is the basename of the resolved target.
        const name = basename(resolve(process.cwd(), trimmed));
        if (!NAME_PATTERN.test(name)) {
          return "Use lowercase letters, digits, and hyphens (e.g. my-app).";
        }
        return undefined;
      },
    });
    if (isCancel(answer)) {
      cancel("init cancelled");
      return 1;
    }
    nameArg = answer.trim();
  }

  // nameArg may be a bare name (`my-app`), `.`, or a path (`./apps/my-app`).
  const target = resolve(process.cwd(), nameArg);
  const projectName = basename(target);

  if (!NAME_PATTERN.test(projectName)) {
    cancel(
      `Invalid project name "${projectName}". Use lowercase letters, digits, and hyphens (e.g. my-app).`,
    );
    return 1;
  }

  if (await pathExists(target)) {
    const entries = (await readdir(target)).filter((e) => e !== ".git");
    if (entries.length > 0 && !force) {
      cancel(`Directory ${nameArg} is not empty. Re-run with --force to scaffold into it anyway.`);
      return 1;
    }
  }

  const s = spinner();
  s.start(`Scaffolding ${pc.cyan(projectName)}`);
  await copyTemplate(TEMPLATE_DIR, target, { PROJECT_NAME: projectName });
  s.stop(`Scaffolded ${pc.cyan(projectName)} ${pc.dim("(apps/web · packages/ui · packages/config)")}`);

  // Offer to install now; on decline (or cancel) fall back to the printed steps.
  // `select` (not `confirm`) so each choice renders on its own line.
  let installed = false;
  const wantsInstall = await select({
    message: "Install dependencies now?",
    options: [
      { value: true, label: `Yes, run ${pc.cyan("pnpm install")}` },
      { value: false, label: "No, I'll run it later" },
    ],
    initialValue: true,
  });
  if (!isCancel(wantsInstall) && wantsInstall) {
    const install = spinner();
    install.start(`Installing dependencies ${pc.dim("(pnpm install)")}`);
    const result = await runPnpmInstall(target);
    if (result.ok) {
      installed = true;
      install.stop(`Installed dependencies ${pc.dim("(pnpm install)")}`);
    } else {
      // Don't break the flow — report and let the user finish it by hand.
      install.stop(pc.yellow("pnpm install did not finish"), 1);
      log.warn(`Couldn't install dependencies automatically — run ${pc.cyan("pnpm install")} yourself.`);
      if (result.message) {
        // Keep it to the tail so the rail output stays readable.
        log.error(result.message.split("\n").slice(-5).join("\n"));
      }
    }
  }

  const steps = [
    nameArg !== "." ? `cd ${nameArg}` : null,
    installed ? null : "pnpm install",
    `pnpm dev                     ${pc.dim("# run dev servers")}`,
  ]
    .filter((line): line is string => line !== null)
    .map((line) => pc.cyan(line))
    .join("\n");

  note(steps, "Next steps");
  outro(pc.green(`🎉 Created ${projectName} successfully.`));
  return 0;
}
