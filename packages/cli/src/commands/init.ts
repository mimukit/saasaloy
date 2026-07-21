import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "../lib/fs-utils.js";
import { copyTemplate } from "../lib/scaffold.js";
import { logger } from "../lib/logger.js";

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
  const nameArg = positional[0];

  if (!nameArg) {
    logger.error("Usage: saasaloy init <project-name>");
    logger.step("Use `.` to scaffold into the current directory.");
    return 1;
  }

  // nameArg may be a bare name (`my-app`), `.`, or a path (`./apps/my-app`).
  const target = resolve(process.cwd(), nameArg);
  const projectName = basename(target);

  if (!NAME_PATTERN.test(projectName)) {
    logger.error(`Invalid project name "${projectName}".`);
    logger.step("Use lowercase letters, digits, and hyphens (e.g. my-app).");
    return 1;
  }

  if (await pathExists(target)) {
    const entries = (await readdir(target)).filter((e) => e !== ".git");
    if (entries.length > 0 && !force) {
      logger.error(`Directory ${nameArg} is not empty.`);
      logger.step("Re-run with --force to scaffold into it anyway.");
      return 1;
    }
  }

  logger.info(`Scaffolding ${projectName} …`);
  await copyTemplate(TEMPLATE_DIR, target, { PROJECT_NAME: projectName });
  logger.step("wrote base (apps/web · packages/ui · packages/config)");

  logger.success(`created ${projectName}`);
  logger.info("");
  logger.info("Next steps:");
  if (nameArg !== ".") logger.step(`cd ${nameArg}`);
  logger.step("pnpm install");
  logger.step("pnpm dev                    # astro dev on apps/web");
  logger.step("pnpm --filter web run deploy  # wrangler deploy to Cloudflare");
  logger.step("saasaloy add waitlist       # add your first feature");
  return 0;
}
