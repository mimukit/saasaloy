// Keep the playground in step with the sources it was built from, so an edit shows up in
// a running `pnpm play:dev` without a manual re-init or re-add.
//
// - A change under `packages/cli/templates/base` re-runs `init --force --no-install`. It
//   only re-copies files, re-applies tokens and syncs; it never touches the playground's
//   node_modules. It also resets `saasaloy.json` to a base-only project, so it is skipped
//   while any module is installed: `pnpm play:reset` picks up a template edit then.
// - A change under `modules/<module>/files/` or to `modules/<module>/registry-item.json`
//   re-runs `add <module> --force --yes` through the shim, for installed modules only
//   (#178). `add` reuses the manifest update, the drift guard and the patch engine, so a
//   file with local playground edits is held back as drift, never overwritten. It takes
//   0.6s to 0.7s per module, so there is no per-file copier.
//
// One run at a time, with a queue, so two writers never race on the manifest.
//
// Zero-dep: fs.watch with { recursive: true } (Node 20+ on macOS/Windows/Linux).
// Run `pnpm play:init` once first, then this in one terminal and `pnpm play:dev` in another.
import { spawn } from "node:child_process";
import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

const DEBOUNCE_MS = 150;

export interface ModuleChange {
  module: string;
  /** The descriptor changed, so a removed patch or file may linger in the playground. */
  descriptor: boolean;
}

/**
 * The module a path under `modules/` belongs to, or `undefined` when the path is not
 * something `add` copies from. `path` is relative to `modules/`, as `fs.watch` reports it.
 */
export function moduleChange(path: string): ModuleChange | undefined {
  const parts = path.split(/[\\/]/);
  const [module, second] = parts;
  if (!module || !second) {
    return undefined;
  }
  if (parts.length === 2 && second === "registry-item.json") {
    return { descriptor: true, module };
  }
  if (second === "files" && parts.length > 2) {
    return { descriptor: false, module };
  }
  return undefined;
}

/** The `installed` list of a playground's `saasaloy.json`. */
export function installedModules(configJson: string): string[] {
  const config = JSON.parse(configJson) as { installed?: unknown };
  if (!Array.isArray(config.installed)) {
    return [];
  }
  return config.installed.filter(
    (name): name is string => typeof name === "string"
  );
}

// The labels `add` prints beside a target (ACTION_LABEL in packages/cli/src/commands/add.ts).
const FILE_LINE =
  /^[^a-z]*(overwrite|create|drift → merge|conflict → merge) {2}(\S+)/;
// oxlint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ANSI = /\u001B\[[0-9;]*m/g;

/**
 * The files one `add` run wrote and the ones it held back, each listed once. The plan box
 * and the step lines name the same file twice, and a held-back file shows again in the
 * Needs merge box.
 */
export function parseAddOutput(output: string): {
  written: string[];
  heldBack: string[];
} {
  const written = new Set<string>();
  const heldBack = new Set<string>();
  for (const line of output.replace(ANSI, "").split("\n")) {
    const match = FILE_LINE.exec(line);
    if (!match) {
      continue;
    }
    const [, action, target] = match;
    if (target === undefined) {
      continue;
    }
    if (action === "overwrite" || action === "create") {
      written.add(target);
    } else {
      heldBack.add(target);
    }
  }
  return { heldBack: [...heldBack], written: [...written] };
}

const TEMPLATE = Symbol("template");
type Job = typeof TEMPLATE | string;

function main(): void {
  const root = resolve(import.meta.dirname, "..");
  const templateDir = resolve(root, "packages/cli/templates/base");
  const modulesDir = resolve(root, "modules");
  const cli = resolve(root, "packages/cli/dist/index.js");
  const target = ".dev/playground";
  const playground = resolve(root, target);

  const timers = new Map<Job, ReturnType<typeof setTimeout>>();
  const descriptorChanged = new Set<string>();
  const queue: Job[] = [];
  let running = false;

  function installed(): string[] | undefined {
    try {
      return installedModules(
        readFileSync(resolve(playground, "saasaloy.json"), "utf-8")
      );
    } catch {
      return undefined;
    }
  }

  function rescaffold(done: () => void): void {
    const modules = installed() ?? [];
    if (modules.length > 0) {
      console.log(
        `[watch] template changed, but init --force would drop the ${modules.length} installed module(s). Skipped; run pnpm play:reset to rebuild the playground with it.`
      );
      done();
      return;
    }
    const child = spawn(
      "node",
      [cli, "init", target, "--force", "--no-install"],
      {
        cwd: root,
        stdio: "inherit",
      }
    );
    child.on("exit", done);
  }

  function sync(module: string, done: () => void): void {
    const modules = installed();
    if (!modules) {
      console.log(
        `[sync] no ${target}/saasaloy.json, run pnpm play:init first`
      );
      done();
      return;
    }
    if (!modules.includes(module)) {
      console.log(`[sync] ${module}: not installed in the playground, skipped`);
      done();
      return;
    }
    const descriptor = descriptorChanged.delete(module);
    const started = performance.now();
    const child = spawn(
      resolve(playground, "saasaloy"),
      ["add", module, "--force", "--yes"],
      { cwd: playground, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      console.error(
        `[sync] ${module}: could not run the shim: ${error.message}`
      );
      done();
    });
    child.on("exit", (code) => {
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (code !== 0) {
        process.stdout.write(output);
        console.error(`[sync] ${module}: add --force failed (exit ${code})`);
        done();
        return;
      }
      const { heldBack, written } = parseAddOutput(output);
      console.log(
        `[sync] ${module}: ${written.length} file(s) written in ${seconds}s`
      );
      for (const file of written) {
        console.log(`  wrote  ${file}`);
      }
      if (heldBack.length > 0) {
        console.log(
          `[sync] ${module}: held back as drift, the playground copy has local edits:`
        );
        for (const file of heldBack) {
          console.log(`  kept   ${file}`);
        }
      }
      if (descriptor) {
        console.log(
          `[sync] ${module}: registry-item.json changed. A removed patch or file is not reversed; pnpm play:restore clears it.`
        );
      }
      done();
    });
  }

  function drain(): void {
    const job = queue.shift();
    if (job === undefined) {
      running = false;
      return;
    }
    running = true;
    if (job === TEMPLATE) {
      rescaffold(drain);
    } else {
      sync(job, drain);
    }
  }

  function enqueue(job: Job): void {
    if (!queue.includes(job)) {
      queue.push(job);
    }
    if (!running) {
      drain();
    }
  }

  // Debounced per job, so a save that touches three files of one module runs one add,
  // and an edit to one module never delays another.
  function schedule(job: Job): void {
    const pending = timers.get(job);
    if (pending) {
      clearTimeout(pending);
    }
    timers.set(
      job,
      setTimeout(() => {
        timers.delete(job);
        enqueue(job);
      }, DEBOUNCE_MS)
    );
  }

  console.log(`[watch] watching ${templateDir}`);
  console.log(`[watch] watching ${modulesDir}/*/files and registry-item.json`);
  console.log(`[watch] syncing -> ${target} on change (Ctrl-C to stop)`);

  watch(templateDir, { recursive: true }, (_event, filename) => {
    if (filename) {
      console.log(`[watch] changed: ${filename}`);
    }
    schedule(TEMPLATE);
  });

  watch(modulesDir, { recursive: true }, (_event, filename) => {
    const change = filename ? moduleChange(filename) : undefined;
    if (!change) {
      return;
    }
    console.log(`[watch] changed: modules/${filename}`);
    if (change.descriptor) {
      descriptorChanged.add(change.module);
    }
    schedule(change.module);
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  main();
}
