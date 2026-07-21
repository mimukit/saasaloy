// Re-scaffold the playground whenever `packages/cli/templates/base` changes, so
// template edits show up in a running `pnpm play:dev` (Astro HMR) without a manual
// re-init. `init --force` only re-copies files + re-applies tokens + syncs — it never
// touches the playground's node_modules, so the loop stays fast.
//
// Zero-dep: fs.watch with { recursive: true } (Node 20+ on macOS/Windows/Linux).
// Run `pnpm play:init` once first, then this in one terminal and `pnpm play:dev` in another.
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = resolve(root, "packages/cli/templates/base");
const cli = resolve(root, "packages/cli/dist/index.js");
const target = ".dev/playground";

let timer = null;
let running = false;
let queued = false;

function rescaffold() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const child = spawn("node", [cli, "init", target, "--force"], { cwd: root, stdio: "inherit" });
  child.on("exit", () => {
    running = false;
    if (queued) {
      queued = false;
      rescaffold();
    }
  });
}

console.log(`[watch] watching ${templateDir}`);
console.log(`[watch] re-scaffolding -> ${target} on change (Ctrl-C to stop)`);
rescaffold();

watch(templateDir, { recursive: true }, (_event, filename) => {
  if (filename) console.log(`[watch] changed: ${filename}`);
  clearTimeout(timer);
  timer = setTimeout(rescaffold, 150);
});
