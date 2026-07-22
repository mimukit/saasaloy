import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, intro, isCancel, note, outro, spinner, text } from "@clack/prompts";
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

  const steps = [
    nameArg !== "." ? `cd ${nameArg}` : null,
    "pnpm install",
    `pnpm dev                     ${pc.dim("# astro dev on apps/web")}`,
    `pnpm --filter web run deploy ${pc.dim("# wrangler deploy to Cloudflare")}`,
    `saasaloy add waitlist        ${pc.dim("# add your first feature")}`,
  ]
    .filter((line): line is string => line !== null)
    .map((line) => pc.cyan(line))
    .join("\n");

  note(steps, "Next steps");
  outro(pc.green(`created ${projectName}`));
  return 0;
}
