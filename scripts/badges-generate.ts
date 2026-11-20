import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "apps/web/public/badges.json");
const modules = globSync("modules/*/registry-item.json", { cwd: root }).length;
const content = `${JSON.stringify({ modules }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf-8") !== content) {
    console.error(
      "badges:check: module count is stale. Run `pnpm badges:generate` and commit the result."
    );
    process.exitCode = 1;
  } else {
    console.log(`badges:check: ${modules} module descriptors match.`);
  }
} else {
  writeFileSync(target, content);
  console.log(`badges:generate: wrote ${modules} modules to ${target}.`);
}
