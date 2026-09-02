import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { parseDevVars } from "../lib/dev-vars.js";
import {
  apiWorkspace,
  appendVars,
  discoverWorkspaces,
  findWranglerWorkspaces,
  isSet,
  productionSecretCommands,
  routeVariable,
  targetFileName,
  workspaceForPath,
  workspacesByModule,
} from "../lib/env-vars.js";
import type { Declaration } from "../lib/env-vars.js";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import {
  assertNoSymlinkPath,
  pathExists,
  resolveWithinRoot,
} from "../lib/fs-utils.js";
import { isPathIgnored } from "../lib/gitignore.js";
import { loadLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import { findProjectRoot } from "../lib/project.js";
import {
  LocalRegistrySource,
  REGISTRY_ENV,
  RemoteRegistrySource,
} from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import type { LoadedConfig } from "../lib/saasaloy-config.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy env` — fill in the variables the installed modules declare (#50).
//
// Before this, `add` rendered `apps/api/.dev.vars.example` and stopped there: the project
// knew what it needed and no file on disk had it. A `PUBLIC_*` value was worse off still,
// because it belongs in the frontend's `.env`, which the example file never described.
//
// The command fills blanks and nothing else. A value already typed is never rewritten,
// whatever the descriptor's `devVars` suggests, because the person who typed it knew
// something the descriptor did not. It refuses to write at all unless git ignores the
// target, and it prints the production commands rather than running them: putting a
// secret into a live account is a deploy, and this is a scaffolding tool.

export interface Options {
  /** `--check`: report what is missing and exit non-zero, prompting for nothing. */
  check: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--check", "--help", "-h"]);
const USAGE = "saasaloy env [--check]";
const HELP: CommandHelp = {
  name: "env",
  describe: DESCRIPTIONS.env,
  usage: USAGE,
  flags: {
    "--check": "report missing variables and exit non-zero, without prompting",
  },
};

export function parseArgs(argv: string[]): Options {
  const unknown: string[] = [];
  for (const arg of argv) {
    // Every declared variable is covered; there is no single-variable form to name.
    if (!arg.startsWith("-") || !KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  return { check: argv.includes("--check"), unknown };
}

/** A variable that still needs an answer, and where the answer goes. */
export interface Pending {
  declaration: Declaration;
  /** Project-relative workspace root, or undefined when routing found no target. */
  workspace?: string;
  /** Project-relative target file, or undefined alongside an undefined workspace. */
  file?: string;
  /** Set when routing found several plausible workspaces and a person must pick. */
  choices?: string[];
}

/**
 * One report line per pending variable: the name, the module that declared it, and
 * either the file it will land in or why no file could be chosen.
 *
 * Pure and exported so `--check`'s output is tested without a project on disk.
 */
export function renderPending(pending: Pending[]): string[] {
  return pending.map((entry) => {
    const head = `${pc.cyan(entry.declaration.name)} ${pc.dim(`— declared by ${entry.declaration.module}`)}`;
    if (entry.file) {
      return `${head}\n  ${pc.dim(`→ ${entry.file}`)}`;
    }
    const why = entry.choices
      ? `several workspaces fit (${entry.choices.join(", ")}) — run \`saasaloy env\` to pick one`
      : "no target workspace found — this module wrote no files under a known alias";
    return `${head}\n  ${pc.yellow(`→ ${why}`)}`;
  });
}

/**
 * Read every installed module's descriptor and flatten its `envVars` into declarations.
 *
 * The lock records provenance but not `envVars`, so the descriptions have to come from
 * the registry — the same path `update` takes. Each module is pinned to the SHA the lock
 * resolved, so the wording matches the code actually on disk rather than whatever `main`
 * says today.
 *
 * A module that cannot be read is reported and skipped. One unreachable repo must not
 * hide every other module's variables, and `--check` still gates on the ones it saw.
 */
async function loadDeclarations(
  config: LoadedConfig,
  lock: Lockfile,
  sources: RegistrySource[],
  onSkip: (message: string) => void
): Promise<Declaration[]> {
  const override = process.env[REGISTRY_ENV];
  const local: RegistrySource | undefined = override
    ? new LocalRegistrySource(
        isAbsolute(override) ? override : resolve(process.cwd(), override)
      )
    : undefined;
  const resolvers = new Map<string, RegistrySource>();

  const declarations: Declaration[] = [];
  for (const name of config.installed) {
    const entry = lock.modules[name];
    let source: RegistrySource | undefined = local;
    if (source === undefined) {
      if (!entry) {
        onSkip(
          `${name} has no lock entry — nothing to read its variables from.`
        );
        continue;
      }
      if (entry.source === "local") {
        onSkip(
          `${name} was installed from a local checkout — set ${REGISTRY_ENV} to read its variables.`
        );
        continue;
      }
      const [owner, repo] = entry.source.split("/");
      if (!owner || !repo) {
        onSkip(
          `${name}'s lock source "${entry.source}" isn't an owner/repo coordinate.`
        );
        continue;
      }
      // Pin to the resolved SHA, not the ref: the descriptor has to describe the bytes
      // this project installed, and the ref has moved on by definition when it moved.
      const ref = entry.resolved === "local" ? entry.ref : entry.resolved;
      const key = `${entry.source}@${ref}`;
      let cached = resolvers.get(key);
      if (!cached) {
        cached = new RemoteRegistrySource(owner, repo, ref);
        resolvers.set(key, cached);
        sources.push(cached);
      }
      source = cached;
    }

    try {
      const { item } = await source.readModule(name);
      for (const [variable, description] of Object.entries(
        item.envVars ?? {}
      )) {
        declarations.push({
          description,
          module: name,
          name: variable,
          ...(item.devVars?.[variable] === undefined
            ? {}
            : { devValue: item.devVars[variable] }),
        });
      }
    } catch (error) {
      onSkip(
        `${name}'s descriptor could not be read — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  // Two modules can declare the same variable (`PUBLIC_API_URL` comes from both `admin`
  // and `waitlist`). First declaration wins, so the prompt is asked once.
  const seen = new Set<string>();
  return declarations.filter((declaration) => {
    if (seen.has(declaration.name)) {
      return false;
    }
    seen.add(declaration.name);
    return true;
  });
}

/** The workspace an alias sits in, used to find the base app for a `PUBLIC_*` fallback. */
function workspaceForAlias(
  aliases: Record<string, string>,
  alias: string,
  workspaces: string[]
): string | undefined {
  const value = aliases[alias];
  if (!value) {
    return undefined;
  }
  return workspaceForPath(
    value.endsWith("/") ? value : `${value}/`,
    workspaces
  );
}

/**
 * Write the answers, one file at a time, and report `[file, count]` per file touched.
 *
 * `contents` carries what each file held when the run read it, so the append is built
 * from the same bytes the "already set" decision was made against. Exported because it
 * is the half of `env` that touches disk: the tests drive it directly, since the prompt
 * loop above it needs a terminal that no test process has.
 */
export async function writeAnswers(
  root: string,
  answers: Map<string, [string, string][]>,
  contents: Map<string, string | undefined>
): Promise<[string, number][]> {
  const written: [string, number][] = [];
  for (const [file, additions] of [...answers].toSorted(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (additions.length === 0) {
      continue;
    }
    const abs = resolveWithinRoot(root, file);
    await assertNoSymlinkPath(root, abs);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, appendVars(contents.get(file), additions), "utf-8");
    written.push([file, additions.length]);
  }
  return written;
}

async function readTarget(
  root: string,
  file: string
): Promise<string | undefined> {
  const abs = resolveWithinRoot(root, file);
  // Same guard `dev-vars` takes: the lexical check proves the path is inside the project,
  // and the read that follows would still traverse a planted symlink out of it.
  await assertNoSymlinkPath(root, abs);
  return (await pathExists(abs)) ? readFile(abs, "utf-8") : undefined;
}

export async function runEnv(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  intro(pc.bgCyan(pc.black(" saasaloy env ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  const sources: RegistrySource[] = [];
  try {
    const root = await findProjectRoot();
    const config = await loadConfig(root);
    const manifest = await loadManifest(root);
    const lock = await loadLock(root);

    const declarations = await loadDeclarations(
      config,
      lock,
      sources,
      (msg) => {
        log.warn(msg);
      }
    );
    if (declarations.length === 0) {
      outro(pc.dim("No module declares an environment variable."));
      return EXIT_OK;
    }

    const workspaces = await discoverWorkspaces(root, config.aliases);
    const wranglerWorkspaces = await findWranglerWorkspaces(root, workspaces);
    const byModule = workspacesByModule(manifest, workspaces);
    const api = apiWorkspace(config.aliases);
    const base = workspaceForAlias(
      config.aliases,
      `@${config.base ?? "web"}`,
      workspaces
    );

    // One read per target file, reused for every variable that routes to it, so two
    // variables landing in the same `.dev.vars` see the same "already set" answer.
    const contents = new Map<string, string | undefined>();
    const readOnce = async (file: string): Promise<string | undefined> => {
      if (!contents.has(file)) {
        contents.set(file, await readTarget(root, file));
      }
      return contents.get(file);
    };

    const pending: Pending[] = [];
    const routed: { name: string; workspace: string }[] = [];
    for (const declaration of declarations) {
      const route = routeVariable({
        candidates: byModule.get(declaration.module) ?? [],
        name: declaration.name,
        wranglerWorkspaces,
        ...(api ? { apiWorkspace: api } : {}),
        ...(base ? { baseWorkspace: base } : {}),
      });
      if (route.kind === "resolved") {
        const file = `${route.workspace}/${targetFileName(declaration.name)}`;
        routed.push({ name: declaration.name, workspace: route.workspace });
        const values = parseDevVars((await readOnce(file)) ?? "");
        if (isSet(values, declaration.name)) {
          continue;
        }
        pending.push({ declaration, file, workspace: route.workspace });
        continue;
      }
      pending.push({
        declaration,
        ...(route.kind === "ambiguous" ? { choices: route.choices } : {}),
      });
    }

    // The production block is a report, so it prints on every run — a `--check` in CI is
    // exactly where someone wants the deploy commands to hand to an operator.
    const secretCommands = productionSecretCommands(routed);
    const printSecrets = (): void => {
      if (secretCommands.length > 0) {
        note(
          wrapForNote(
            `${secretCommands.join("\n")}\n\n${pc.dim("Printed, never run — copy these when you deploy.")}`
          ),
          "Production secrets"
        );
      }
    };

    if (pending.length === 0) {
      printSecrets();
      outro(pc.green("Every declared variable is set."));
      return EXIT_OK;
    }

    // Prove every file is ignored before asking for a single secret. Typing an API key
    // into a prompt that then refuses to write it wastes the key as much as the typing —
    // and the same refusal is the right answer under `--check`, where it says the deploy
    // gate would have written a secret into a tracked file.
    const files = [
      ...new Set(pending.flatMap((entry) => (entry.file ? [entry.file] : []))),
    ].toSorted();
    for (const file of files) {
      if (!(await isPathIgnored(root, file))) {
        cancel(
          `${pc.cyan(file)} isn't gitignored — refusing to write a secret into a tracked file. ` +
            `Add it to .gitignore (the base template already does) and run again.`
        );
        return EXIT_REFUSED;
      }
    }

    // `--check` and a session with no terminal take the same path. A prompt nobody can
    // answer is a hang, and a hang in CI is worse than a refusal.
    if (opts.check || !isInteractive()) {
      note(wrapForNote(renderPending(pending).join("\n")), "Missing");
      printSecrets();
      const count = pending.length;
      cancel(
        `${count} variable${count === 1 ? "" : "s"} still unset — run \`saasaloy env\` to fill ${count === 1 ? "it" : "them"} in.`
      );
      return EXIT_REFUSED;
    }

    const answers = new Map<string, [string, string][]>();
    for (const entry of pending) {
      let file = entry.file;
      if (!file) {
        if (!entry.choices) {
          log.warn(
            `${pc.cyan(entry.declaration.name)} — no target workspace found; set it by hand.`
          );
          continue;
        }
        const picked = await select({
          message: `Which workspace reads ${entry.declaration.name}?`,
          options: entry.choices.map((workspace) => ({
            label: workspace,
            value: workspace,
          })),
        });
        if (isCancel(picked)) {
          cancel("Cancelled — nothing written.");
          return EXIT_REFUSED;
        }
        file = `${picked}/${targetFileName(entry.declaration.name)}`;
        if (!(await isPathIgnored(root, file))) {
          cancel(
            `${pc.cyan(file)} isn't gitignored — refusing to write a secret into a tracked file.`
          );
          return EXIT_REFUSED;
        }
        const values = parseDevVars((await readOnce(file)) ?? "");
        if (isSet(values, entry.declaration.name)) {
          continue;
        }
      }

      // The message is the descriptor's own wording. `env` does not paraphrase it: the
      // module author wrote the sentence that explains what the value is for, and a
      // second wording here would drift from the one in `.dev.vars.example`.
      const answer = await text({
        defaultValue: entry.declaration.devValue ?? "",
        message: `${pc.cyan(entry.declaration.name)} ${pc.dim(`→ ${file}`)}\n${entry.declaration.description}`,
        ...(entry.declaration.devValue === undefined
          ? {}
          : { initialValue: entry.declaration.devValue }),
      });
      if (isCancel(answer)) {
        cancel("Cancelled — nothing written.");
        return EXIT_REFUSED;
      }
      answers.set(file, [
        ...(answers.get(file) ?? []),
        [entry.declaration.name, answer],
      ]);
    }

    const written = await writeAnswers(root, answers, contents);
    if (written.length > 0) {
      note(
        wrapForNote(
          written
            .map(
              ([file, count]) =>
                `${pc.cyan(file)} ${pc.dim(`— ${count} added`)}`
            )
            .join("\n")
        ),
        "Written"
      );
    }
    printSecrets();
    outro(pc.green("Environment filled in."));
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  } finally {
    for (const source of sources) {
      await source.cleanup?.();
    }
  }
}
