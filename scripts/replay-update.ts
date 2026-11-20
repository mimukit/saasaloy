// Replay a project's update through the render engine (plan 0116, Phase 5), and count the
// files that need an agent.
//
//   node scripts/replay-update.ts <project> <commit> [--to <version>] [--no-format]
//
// The project at <commit> is a version 1 project, made by the old engine. The script
// copies it with `git archive` into a temporary folder, so nothing writes to the project
// repo, its working tree or its worktree list. There it converts the manifest and the
// lock (`engine/convert.ts`), then updates the copy to <version> with the engine's own
// classes, merges and `apply`, and prints how many files each result kind holds.
//
// The default <version> is 0.8.0: research 0013 replayed the PrimeShopr update from
// d9cc35fc to 0.8.0, and plan 0116 sets its target (at most 45 files for an agent) on
// that replay. The sides are the research's:
//
//   - base: for each file, the render at the release whose copied source hashes to the
//     recorded hash, as the conversion finds it;
//   - theirs: the render of the project's set at <version>;
//   - mine: the project file at <commit>.
//
// Payloads come from this repo's own git history, by `git archive` of `modules/` and the
// base template at each ref, into a payload cache: `SAASALOY_CACHE_DIR` when it is set,
// else a temporary folder the script removes. No network.
//
// A patched file reached the disk through the project's Prettier, so `apply` formats both
// sides of it. The copy links `node_modules` to the project's own, when it has one, so
// the project's Prettier runs. `--no-format` compares raw renders instead.
//
// The CLI's engine is TypeScript that uses syntax type stripping does not cover, so the
// script loads it through a module hook: `.js` specifiers resolve to the `.ts` source, and
// `stripTypeScriptTypes` transforms each file under `packages/cli/src/`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as ApplyModule from "../packages/cli/src/engine/apply.ts";
import type * as ConvertModule from "../packages/cli/src/engine/convert.ts";
import type * as LockModule from "../packages/cli/src/lib/lock.ts";
import type * as PayloadModule from "../packages/cli/src/engine/payload.ts";
import type * as ProjectModule from "../packages/cli/src/engine/project.ts";
import type * as VersionModule from "../packages/cli/src/version.ts";

const REPO = resolve(import.meta.dirname, "..");
const CLI_SRC = join(REPO, "packages/cli/src");
const CLI_SRC_URL = `${pathToFileURL(CLI_SRC).href}/`;
const DEFAULT_TO = "0.8.0";

/** Result kinds an agent must act on: a file with markers, or a decision to make. */
const AGENT_KINDS = new Set([
  "conflict",
  "both-no-base",
  "no-base",
  "upstream-deleted-owner-edited",
]);

function usage(): never {
  process.stderr.write(
    "usage: node scripts/replay-update.ts <project> <commit> [--to <version>] [--no-format]\n"
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): {
  project: string;
  commit: string;
  to: string;
  format: boolean;
} {
  const positional: string[] = [];
  let to = DEFAULT_TO;
  let format = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--to") {
      to = argv[i + 1] ?? usage();
      i++;
    } else if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    } else if (arg === "--no-format") {
      format = false;
    } else if (arg.startsWith("-")) {
      usage();
    } else {
      positional.push(arg);
    }
  }
  const [project, commit] = positional;
  if (project === undefined || commit === undefined || positional.length > 2) {
    usage();
  }
  return { commit, format, project: resolve(project), to };
}

// Node 24 (`.nvmrc`) still has the `transform` mode, which turns the parameter properties
// in `lib/registry.ts` and `lib/update-notes.ts` into plain code. `@types/node` 26 types
// only `strip`, so the call is typed here.
const transformTypeScript = stripTypeScriptTypes as unknown as (
  code: string,
  options: { mode: "transform"; sourceUrl: string }
) => string;

/** Load `packages/cli/src` as the CLI's build would see it. */
function hookCliSource(): void {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith(CLI_SRC_URL) && url.endsWith(".ts")) {
        const source = readFileSync(fileURLToPath(url), "utf-8");
        return {
          format: "module",
          shortCircuit: true,
          source: transformTypeScript(source, {
            mode: "transform",
            sourceUrl: url,
          }),
        };
      }
      return nextLoad(url, context);
    },
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? "";
      if (
        parent.startsWith(CLI_SRC_URL) &&
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        !existsSync(fileURLToPath(new URL(specifier, parent)))
      ) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
  // The transform is experimental in Node 24; its one warning is noise here.
  const emit = process.emitWarning.bind(process);
  process.emitWarning = (warning: string | Error, ...rest: never[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (!text.includes("stripTypeScriptTypes")) {
      emit(warning, ...rest);
    }
  };
}

/** Extract one folder of `repo` at `ref` into `dir`. */
function archive(repo: string, ref: string, path: string, dir: string): void {
  const strip = path === "." ? 0 : path.split("/").length;
  execFileSync(
    "sh",
    [
      "-c",
      'git -C "$1" archive --format=tar "$2" -- "$3" | tar -x -C "$4" --strip-components="$5"',
      "sh",
      repo,
      ref,
      path,
      dir,
      String(strip),
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  hookCliSource();
  const { apply } = (await import(
    `${CLI_SRC_URL}engine/apply.ts`
  )) as typeof ApplyModule;
  const { convertProject, candidateLoader, searchedReleases } = (await import(
    `${CLI_SRC_URL}engine/convert.ts`
  )) as typeof ConvertModule;
  const { CACHE_DIR_ENV } = (await import(
    `${CLI_SRC_URL}engine/payload.ts`
  )) as typeof PayloadModule;
  const { loadBaseSides, loadSide, readProjectState } = (await import(
    `${CLI_SRC_URL}engine/project.ts`
  )) as typeof ProjectModule;
  const { readVersion } = (await import(
    `${CLI_SRC_URL}version.ts`
  )) as typeof VersionModule;

  const scratch = await mkdtemp(join(tmpdir(), "saasaloy-replay-"));
  const copy = join(scratch, "project");
  const cache = process.env[CACHE_DIR_ENV] ?? join(scratch, "cache");
  try {
    await mkdir(copy, { recursive: true });
    archive(args.project, args.commit, ".", copy);
    const modules = join(args.project, "node_modules");
    if (args.format && existsSync(join(modules, ".bin", "prettier"))) {
      await symlink(modules, join(copy, "node_modules"), "dir");
    }

    // The payload of each ref, from this repo's history: a release tag or a commit. A
    // local registry checkout would stand in for every release, so it is ignored.
    const env = {
      ...process.env,
      [CACHE_DIR_ENV]: cache,
      SAASALOY_REGISTRY_DIR: undefined,
    };
    const fetcher: PayloadModule.PayloadFetcher = async (snapshot, { ref }) => {
      archive(REPO, ref, "modules", snapshot.modulesDir);
      archive(REPO, ref, "packages/cli/templates/base", snapshot.baseDir);
      await Promise.resolve();
    };
    const context = {
      // Never a release this script renders, so each side reads its own release's
      // template from the cache rather than the one in this checkout.
      cliVersion: `${await readVersion()}-replay`,
      env,
      fetcher,
    };
    // Without Prettier, a patched file is compared as rendered.
    const format = args.format
      ? undefined
      : (_path: string, content: string): Promise<string> =>
          Promise.resolve(content);

    // The conversion searches what the CLI of <version> would: each old-engine release
    // up to it, among the tags this repo holds.
    const { loadLock } = (await import(
      `${CLI_SRC_URL}lib/lock.ts`
    )) as typeof LockModule;
    const releases = searchedReleases(args.to, env).filter(
      (release) =>
        execFileSync("git", ["-C", REPO, "tag", "--list", `v${release}`], {
          encoding: "utf-8",
        }).trim() !== ""
    );
    const conversion = await convertProject({
      load: candidateLoader(await loadLock(copy), context),
      releases,
      root: copy,
      ...(format === undefined ? {} : { format }),
    });
    const found = conversion.files.filter((file) => file.version !== undefined);
    const byVersion = new Map<string, number>();
    for (const file of found) {
      const version = file.version ?? "";
      byVersion.set(version, (byVersion.get(version) ?? 0) + 1);
    }

    const state = await readProjectState(copy, {
      lock: conversion.lock,
      manifest: conversion.manifest,
    });
    const previousVersion = state.version ?? args.to;
    const previous = await loadSide(
      {
        coordinates: state.coordinates,
        options: state.options,
        partial: true,
        requested: state.requested,
        version: previousVersion,
      },
      context
    );
    const next = await loadSide(
      {
        coordinates: state.coordinates,
        options: state.options,
        requested: state.requested,
        version: args.to,
      },
      context
    );
    const bases = await loadBaseSides(state, previousVersion, context);
    const report = await apply({
      bases: bases.sides,
      cleanTree: "none",
      dryRun: true,
      next: next.side,
      previous: previous.side,
      root: copy,
      state: { lock: conversion.lock, manifest: conversion.manifest },
      version: args.to,
      ...(format === undefined ? {} : { format }),
    });

    const lines: string[] = [
      `replay: ${args.project} at ${args.commit}, update to saasaloy ${args.to}`,
      "",
      `conversion: ${String(conversion.files.length)} tracked files, base found for ${String(found.length)}`,
    ];
    for (const [version, count] of [...byVersion].toSorted(([a], [b]) =>
      a.localeCompare(b)
    )) {
      lines.push(`  ${pad(version, 10)} ${String(count)}`);
    }
    for (const file of conversion.files.filter(
      (entry) => entry.version === undefined
    )) {
      lines.push(
        `  no base: ${file.path} (${file.record === undefined ? "a file on both sides" : "deleted, record kept"})`
      );
    }
    for (const warning of [...conversion.warnings, ...bases.warnings]) {
      lines.push(`  note: ${warning.split("\n")[0] ?? ""}`);
    }
    const kinds = new Map<string, number>();
    for (const result of report.results) {
      kinds.set(result.kind, (kinds.get(result.kind) ?? 0) + 1);
    }
    lines.push(
      "",
      `update: ${String(report.results.length)} paths`,
      `  ${pad("result kind", 32)} ${pad("files", 6)} agent`
    );
    for (const [kind, count] of [...kinds].toSorted((a, b) => b[1] - a[1])) {
      lines.push(
        `  ${pad(kind, 32)} ${pad(String(count), 6)} ${AGENT_KINDS.has(kind) ? "yes" : ""}`
      );
    }
    const agent = report.results.filter(
      (result) =>
        AGENT_KINDS.has(result.kind) &&
        (result.kind === "upstream-deleted-owner-edited" ||
          (result.conflicts ?? 0) > 0)
    );
    lines.push("", `files that need an agent: ${String(agent.length)}`);
    const agentKinds = new Map<string, number>();
    for (const result of agent) {
      agentKinds.set(result.kind, (agentKinds.get(result.kind) ?? 0) + 1);
    }
    for (const [kind, count] of [...agentKinds].toSorted(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`  ${pad(kind, 32)} ${String(count)}`);
    }
    lines.push("");
    for (const result of agent) {
      const conflicts =
        result.conflicts === undefined
          ? ""
          : ` ${String(result.conflicts)} conflict${result.conflicts === 1 ? "" : "s"}`;
      lines.push(
        `  ${pad(result.kind, 30)} ${pad(result.class, 7)}${conflicts}  ${result.path}`
      );
    }
    const once = report.results.filter((result) => result.kind === "once-left");
    if (once.length > 0) {
      lines.push(
        "",
        "written once, changed upstream (a report line, no agent):"
      );
      for (const result of once) {
        lines.push(`  ${result.path}`);
      }
    }
    for (const warning of report.warnings) {
      lines.push(`warning: ${warning.split("\n")[0] ?? ""}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    // A cache the caller named lies outside `scratch` and stays for the next run.
    await rm(scratch, { force: true, recursive: true });
  }
}

process.exitCode = await main();
