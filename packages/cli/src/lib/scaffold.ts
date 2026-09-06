import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import cliPackage from "../../package.json" with { type: "json" };
import { hashContent, pathExists } from "./fs-utils.js";

// Copy a template tree into a target dir, applying two conventions:
//   - files named `_foo` become `.foo` (npm refuses to publish literal dotfiles
//     like `.gitignore` inside a package, so templates store them de-dotted)
//   - `{{VAR}}` tokens in file contents are replaced from `vars`
// All template files are UTF-8 text, so every file gets token substitution.

export type TemplateVars = Record<string, string>;

/**
 * The base template's own declaration (#120): which of its files are seed — meant to be
 * rewritten by the owner, so never updated — as an explicit path list. It describes the
 * template and is not part of it, so `copyTemplate` skips it by this exact name, before
 * the `_` → `.` rename would turn it into a dotfile in someone's project.
 */
export const BASE_DECLARATION = "_saasaloy-base.json";

// The base template is bundled at <pkg>/templates/base. At runtime import.meta.url is
// <pkg>/dist/index.js, so `../templates` resolves; under vitest it is <pkg>/src/lib/
// scaffold.ts, so the template sits one level further up. Try both, the way
// `lib/schema.ts` finds its schemas — without it `init` is only reachable from a build,
// which is what kept it untested (#47).
const TEMPLATE_DIR_CANDIDATES = ["../templates/base", "../../templates/base"];

/** Absolute path of the bundled base template. `init` copies it; `doctor` reads its aliases. */
export async function baseTemplateDir(): Promise<string> {
  for (const candidate of TEMPLATE_DIR_CANDIDATES) {
    const dir = fileURLToPath(new URL(candidate, import.meta.url));
    if (await pathExists(join(dir, "package.json"))) {
      return dir;
    }
  }
  // Fall back to the packaged location, for a sensible ENOENT naming the real path.
  return fileURLToPath(new URL(TEMPLATE_DIR_CANDIDATES[0]!, import.meta.url));
}

// The substitutions the base template expects. CLI_VERSION stamps the DESIGN.md
// seed, so a generated contract records which CLI wrote it.
export function templateVars(projectName: string): TemplateVars {
  return { PROJECT_NAME: projectName, CLI_VERSION: cliPackage.version };
}

/** The `_name` → `.name` rename, applied to one path segment. */
export function renderedName(name: string): string {
  return name.startsWith("_") ? `.${name.slice(1)}` : name;
}

/** One file `copyTemplate` wrote, described the way the manifest records it (#120). */
export interface WrittenFile {
  /** Absolute path of the file as written. */
  path: string;
  /** Project-relative POSIX path after the rename — the manifest key. */
  target: string;
  /** Template-relative POSIX path before the rename — the manifest's `from`. */
  from: string;
  /** sha256 of the rendered bytes, so hashing the template source is never mistaken for it. */
  hash: string;
}

export interface CopyTemplateOptions {
  /**
   * Write under the source names (`_gitignore` stays `_gitignore`). `update` renders the
   * template this way so each file's `from` resolves inside the render, while `target`
   * still says where it lands in the project.
   */
  keepNames?: boolean;
}

export async function copyTemplate(
  srcDir: string,
  destDir: string,
  vars: TemplateVars,
  options: CopyTemplateOptions = {}
): Promise<WrittenFile[]> {
  return copyTree(srcDir, destDir, vars, options, "", "", true);
}

async function copyTree(
  srcDir: string,
  destDir: string,
  vars: TemplateVars,
  options: CopyTemplateOptions,
  fromPrefix: string,
  targetPrefix: string,
  isRoot: boolean
): Promise<WrittenFile[]> {
  const written: WrittenFile[] = [];
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    // The declaration describes the template; it is never part of a project.
    if (isRoot && entry.name === BASE_DECLARATION) {
      continue;
    }
    const srcPath = join(srcDir, entry.name);
    const outName = renderedName(entry.name);
    const destPath = join(destDir, options.keepNames ? entry.name : outName);
    const from = posix.join(fromPrefix, entry.name);
    const target = posix.join(targetPrefix, outName);
    if (entry.isDirectory()) {
      written.push(
        ...(await copyTree(
          srcPath,
          destPath,
          vars,
          options,
          from,
          target,
          false
        ))
      );
    } else if (entry.isFile()) {
      const raw = await readFile(srcPath, "utf-8");
      const rendered = applyVars(raw, vars);
      await writeFile(destPath, rendered, "utf-8");
      written.push({
        path: destPath,
        target,
        from,
        hash: hashContent(rendered),
      });
    }
  }
  return written;
}

function applyVars(content: string, vars: TemplateVars): string {
  return content.replaceAll(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => vars[key] ?? match
  );
}
