import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import cliPackage from "../../package.json" with { type: "json" };

// Copy a template tree into a target dir, applying two conventions:
//   - files named `_foo` become `.foo` (npm refuses to publish literal dotfiles
//     like `.gitignore` inside a package, so templates store them de-dotted)
//   - `{{VAR}}` tokens in file contents are replaced from `vars`
// All template files are UTF-8 text, so every file gets token substitution.

export type TemplateVars = Record<string, string>;

// The substitutions the base template expects. CLI_VERSION stamps the DESIGN.md
// seed, so a generated contract records which CLI wrote it.
export function templateVars(projectName: string): TemplateVars {
  return { PROJECT_NAME: projectName, CLI_VERSION: cliPackage.version };
}

export async function copyTemplate(
  srcDir: string,
  destDir: string,
  vars: TemplateVars
): Promise<string[]> {
  const written: string[] = [];
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const outName = entry.name.startsWith("_")
      ? `.${entry.name.slice(1)}`
      : entry.name;
    const destPath = join(destDir, outName);
    if (entry.isDirectory()) {
      written.push(...(await copyTemplate(srcPath, destPath, vars)));
    } else if (entry.isFile()) {
      const raw = await readFile(srcPath, "utf-8");
      await writeFile(destPath, applyVars(raw, vars), "utf-8");
      written.push(destPath);
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
