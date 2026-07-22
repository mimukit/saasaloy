import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./fs-utils.js";
import type { SaasaloyConfig } from "./schema.js";
import { validateSaasaloyConfig } from "./schema.js";

// `saasaloy.json` is the consumer manifest at a generated project's root: the alias
// map that resolves module file targets, plus the `installed` list that drives
// dependsOn resolution (build spec §3.2). This loads/saves it and turns an
// alias-prefixed target (`@api/routes/x.ts`) into a project-relative path.

export const CONFIG_FILE = "saasaloy.json";

// The raw parse keeps the optional `$schema` pointer so a round-trip save doesn't
// strip an author's editor-validation hint.
export type LoadedConfig = SaasaloyConfig & { $schema?: string };

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const file = join(root, CONFIG_FILE);
  if (!(await pathExists(file))) {
    throw new Error(
      `No ${CONFIG_FILE} found in ${root}. Run \`saasaloy init\` first, or cd into a Saasaloy project.`,
    );
  }
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  const result = await validateSaasaloyConfig(parsed);
  if (!result.valid) {
    throw new Error(`${CONFIG_FILE} is invalid:\n  ${result.errors.join("\n  ")}`);
  }
  return parsed as LoadedConfig;
}

export async function saveConfig(root: string, config: LoadedConfig): Promise<void> {
  const file = join(root, CONFIG_FILE);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// Resolve `@api/routes/x.ts` against the alias map to a project-relative POSIX path
// (e.g. `apps/api/src/routes/x.ts`). POSIX separators keep manifest keys stable
// across OSes; callers split on "/" when touching the filesystem.
export function resolveTarget(aliases: Record<string, string>, target: string): string {
  const slash = target.indexOf("/");
  if (slash === -1) {
    throw new Error(`Malformed target "${target}" — expected "@alias/rest".`);
  }
  const alias = target.slice(0, slash);
  const rest = target.slice(slash + 1);
  const base = aliases[alias];
  if (base === undefined) {
    const known = Object.keys(aliases).join(", ") || "(none)";
    throw new Error(`Unknown alias "${alias}" in target "${target}". Known aliases: ${known}.`);
  }
  // `base` is already POSIX + no leading slash (enforced by the schema); join by hand
  // to avoid the platform separator that node:path would introduce on Windows.
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/${rest}`;
}
