import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { ENV_EXAMPLE, parseEnvExample } from "../lib/env-example.js";
import {
  appendVars,
  isSet,
  LOCAL_VALUES,
  parseEnvFile,
  parseEnvValues,
  productionSecretCommands,
  replaceVars,
} from "../lib/env-vars.js";
import type { Declaration } from "../lib/env-vars.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  RefusalError,
} from "../lib/exit.js";
import {
  assertNoSymlinkPath,
  pathExists,
  resolveWithinRoot,
} from "../lib/fs-utils.js";
import { isPathIgnored } from "../lib/gitignore.js";
import { createOutput, printJson } from "../lib/json-output.js";
import type { Output, TuiOptions } from "../lib/json-output.js";
import { loadLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { findProjectRoot } from "../lib/project.js";
import { text } from "../lib/prompts.js";
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
// Every answer lands in one gitignored file, `packages/env/.env`, which is the `local`
// value source `pnpm env:setup` distributes into each service's own `.env` (#153). There
// is no routing and no "which workspace reads this?" prompt: the descriptor's
// `envServices` decides that, and `packages/env/.env.example` records it.
//
// The command fills blanks and nothing else. A value already typed is never rewritten,
// whatever the descriptor's `devVars` suggests, because the person who typed it knew
// something the descriptor did not. It refuses to write at all unless git ignores the
// target, and it prints the production commands rather than running them: putting a
// secret into a live account is a deploy, and this is a scaffolding tool.
//
// `--set KEY=VALUE` and `--from-file <path>` answer the prompts on the command line, so an
// agent with no terminal can fill the file (#223). A value passed that way is a value a
// person chose, so it replaces what the file holds. A key no installed module declares is
// refused before anything is written: a typo would otherwise land in a file no service
// reads, and the run would report success.
//
// `--check --json` prints the report as one document on stdout (#223). `--json` without
// `--check` refuses: the prompt and the flag paths write, and a write has no report.

export interface Options {
  /** `--check`: report what is missing and exit non-zero, prompting for nothing. */
  check: boolean;
  /** `--json` with `--check`: one JSON document on stdout, the TUI on stderr. */
  json: boolean;
  /** `--from-file <path>`, repeatable, in command-line order. Read relative to cwd. */
  fromFiles: string[];
  /** `--set KEY=VALUE`, repeatable, in command-line order. Beats a file's value. */
  sets: [string, string][];
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--check", "--json", "--help", "-h"]);
const USAGE =
  "saasaloy env [--check [--json]] [--from-file <path>]... [--set KEY=VALUE]...";
const HELP: CommandHelp = {
  name: "env",
  describe: DESCRIPTIONS.env,
  usage: USAGE,
  flags: {
    "--check": "report missing variables and exit non-zero, without prompting",
    "--json": "with --check, print the report as one JSON document on stdout",
    "--from-file <path>":
      "write the KEY=VALUE lines of a dotenv file, with no prompt (repeatable)",
    "--set KEY=VALUE":
      "write one value, with no prompt (repeatable); it stays in your shell history, so prefer --from-file for a secret",
  },
};

// `--set` and `--from-file` take a value, as `--set KEY=VALUE` or `--set=KEY=VALUE`.
const VALUE_FLAGS = ["--set", "--from-file"] as const;

// Both writers refuse with this before a byte lands: before the prompts, and before the
// `--set`/`--from-file` values.
const NOT_IGNORED =
  `${pc.cyan(LOCAL_VALUES)} isn't gitignored — refusing to write a secret into a tracked file. ` +
  "Add it to .gitignore (the base template already does) and run again.";

/** `KEY=VALUE` as one `--set` pair, or the reason it is not one. */
function parseSet(raw: string): [string, string] | string {
  const equals = raw.indexOf("=");
  const name = equals === -1 ? "" : raw.slice(0, equals).trim();
  const value = equals === -1 ? "" : raw.slice(equals + 1);
  if (name === "") {
    return `--set ${raw} (needs KEY=VALUE)`;
  }
  if (value.trim() === "") {
    return `--set ${raw} (has no value)`;
  }
  // One line per key in the file: a newline in the value would write a second line that
  // no check has looked at.
  if (/[\r\n]/.test(value)) {
    return `--set ${name}=… (the value spans more than one line)`;
  }
  return [name, value];
}

export function parseArgs(argv: string[]): Options {
  const unknown: string[] = [];
  const fromFiles: string[] = [];
  const sets: [string, string][] = [];
  const take = (flag: string, value?: string): void => {
    if (value === undefined || value === "") {
      unknown.push(`${flag} (needs a value)`);
    } else if (flag === "--from-file") {
      fromFiles.push(value);
    } else {
      const pair = parseSet(value);
      if (typeof pair === "string") {
        unknown.push(pair);
      } else {
        sets.push(pair);
      }
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const flag = VALUE_FLAGS.find(
      (name) => arg === name || arg.startsWith(`${name}=`)
    );
    if (flag !== undefined) {
      if (arg === flag) {
        // The next argument is the value, unless it is another flag: `--set --check`
        // must not swallow the `--check`.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          i++;
          take(flag, next);
        } else {
          take(flag);
        }
      } else {
        take(flag, arg.slice(flag.length + 1));
      }
      continue;
    }
    // Every declared variable is covered; there is no single-variable form to name.
    if (!arg.startsWith("-") || !KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  return {
    check: argv.includes("--check"),
    fromFiles,
    json: argv.includes("--json"),
    sets,
    unknown,
  };
}

/**
 * Every value the flags pass, in the order they apply: each `--from-file` in turn, then
 * each `--set`, so a `--set` beats a file for the same key. One entry per key, at the
 * position of its last value.
 */
async function readFlagValues(opts: Options): Promise<[string, string][]> {
  const values = new Map<string, string>();
  for (const file of opts.fromFiles) {
    const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
    let content: string;
    try {
      content = await readFile(abs, "utf-8");
    } catch (error) {
      throw new RefusalError(
        `--from-file ${file} could not be read — ${error instanceof Error ? error.message : String(error)}`
      );
    }
    for (const [name, value] of parseEnvFile(content)) {
      values.delete(name);
      values.set(name, value);
    }
  }
  for (const [name, value] of opts.sets) {
    values.delete(name);
    values.set(name, value);
  }
  return [...values.entries()];
}

/** A variable that still needs an answer. Every one goes to the same file. */
export interface Pending {
  declaration: Declaration;
}

/**
 * One report line per pending variable: the name and the module that declared it.
 *
 * Pure and exported so `--check`'s output is tested without a project on disk.
 */
export function renderPending(pending: Pending[]): string[] {
  return pending.map(
    (entry) =>
      `${pc.cyan(entry.declaration.name)} ${pc.dim(`— declared by ${entry.declaration.module}`)}`
  );
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

/**
 * Write the answers into `packages/env/.env` and report how many landed.
 *
 * `before` is what the file held when the run read it, so the append is built from the
 * same bytes the "already set" decision was made against. Exported because it is the half
 * of `env` that touches disk: the tests drive it directly, since the prompt loop above it
 * needs a terminal that no test process has.
 */
export async function writeAnswers(
  root: string,
  additions: [string, string][],
  before?: string
): Promise<number> {
  if (additions.length === 0) {
    return 0;
  }
  const abs = resolveWithinRoot(root, LOCAL_VALUES);
  await assertNoSymlinkPath(root, abs);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, appendVars(before, additions), "utf-8");
  return additions.length;
}

/**
 * Write the values `--set` and `--from-file` passed into `packages/env/.env`, replacing
 * any value the file holds for the same key (#223). `before` plays the same part it does
 * in `writeAnswers`.
 */
export async function writeValues(
  root: string,
  values: [string, string][],
  before?: string
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }
  const abs = resolveWithinRoot(root, LOCAL_VALUES);
  await assertNoSymlinkPath(root, abs);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, replaceVars(before, values), "utf-8");
  return values.length;
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

/** The production block, printed on every run that reaches the declarations. */
function printSecretCommands(
  declarations: Declaration[],
  tui: TuiOptions = {}
): void {
  const secretCommands = productionSecretCommands(
    declarations.map((declaration) => declaration.name)
  );
  if (secretCommands.length > 0) {
    note(
      wrapForNote(
        `${secretCommands.join("\n")}\n\n${pc.dim("Printed, never run — copy these when you deploy.")}`
      ),
      "Production secrets",
      tui
    );
  }
}

/** What `env --check --json` reports (#223). Pure and exported for its own test. */
export interface CheckReport {
  /** Every declared variable, first declaration wins, in install order. */
  variables: {
    name: string;
    module: string;
    description: string;
    set: boolean;
  }[];
  /** The names still unset — the ones that make `--check` exit 2. */
  missing: string[];
  /** Declared names `packages/env/.env.example` does not list, so no service reads them. */
  notInKeyList: string[];
  /** Why a module's variables could not be read. */
  skipped: string[];
  /** The `wrangler secret put` lines the production block prints. */
  productionSecrets: string[];
}

export function checkReport(args: {
  declarations: Declaration[];
  values: ReturnType<typeof parseEnvValues>;
  notInKeyList: string[];
  skipped: string[];
}): CheckReport {
  const variables = args.declarations.map((declaration) => ({
    description: declaration.description,
    module: declaration.module,
    name: declaration.name,
    set: isSet(args.values, declaration.name),
  }));
  return {
    missing: variables.filter((v) => !v.set).map((v) => v.name),
    notInKeyList: args.notInKeyList,
    productionSecrets: productionSecretCommands(
      args.declarations.map((declaration) => declaration.name)
    ),
    skipped: args.skipped,
    variables,
  };
}

interface FlagRun {
  before: string | undefined;
  declarations: Declaration[];
  opts: Options;
  out: Output;
  root: string;
}

/**
 * The `--set`/`--from-file` half of `env` (#223). No prompt opens, so it runs the same
 * with or without a terminal. The gitignore check runs first, as it does before the
 * prompts, then every passed key is checked against the declarations, and one unknown key
 * refuses the whole run before a byte is written. A key still unset afterwards is a
 * warning, not a failure: the agent filled what it was given, and `--check` is the gate.
 */
async function writeFlagValues(run: FlagRun): Promise<number> {
  const { before, declarations, opts, out, root } = run;
  const values = await readFlagValues(opts);

  if (!(await isPathIgnored(root, LOCAL_VALUES))) {
    return out.refuse(NOT_IGNORED, EXIT_REFUSED);
  }

  const declared = new Set(declarations.map((declaration) => declaration.name));
  const unknown = values
    .map(([name]) => name)
    .filter((name) => !declared.has(name));
  if (unknown.length > 0) {
    return out.refuse(
      `No installed module declares ${unknown.join(", ")} — nothing written. ` +
        `Check the spelling, or \`saasaloy add\` the module that reads ${unknown.length === 1 ? "it" : "them"}.`,
      EXIT_REFUSED
    );
  }

  if (values.length === 0) {
    log.warn("The files passed with `--from-file` set no value.");
  }
  const written = await writeValues(root, values, before);
  if (written > 0) {
    note(
      wrapForNote(
        `${pc.cyan(LOCAL_VALUES)} ${pc.dim(`— ${written} written`)}\n\n${pc.dim("Run `pnpm env:setup` to write each service's own .env from it.")}`
      ),
      "Written"
    );
  }

  const after = parseEnvValues(replaceVars(before, values));
  const unset = declarations.filter(
    (declaration) => !isSet(after, declaration.name)
  );
  if (unset.length > 0) {
    log.warn(
      `Still unset: ${unset.map((declaration) => declaration.name).join(", ")}.`
    );
  }
  printSecretCommands(declarations);
  outro(
    unset.length === 0
      ? pc.green("Every declared variable is set.")
      : pc.green("Values written.")
  );
  return EXIT_OK;
}

export async function runEnv(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const out = createOutput(opts.json);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy env ")), tui);

  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  if (opts.json && !opts.check) {
    return out.refuse(
      "`--json` prints the `--check` report — pass `--check --json`. Filling values has no report to print.",
      EXIT_REFUSED
    );
  }

  const flagMode = opts.sets.length > 0 || opts.fromFiles.length > 0;
  if (opts.check && flagMode) {
    // `--check` promises to write nothing; `--set` and `--from-file` exist to write.
    return out.refuse(
      "`--check` writes nothing, and `--set`/`--from-file` write values — pass one or the other.",
      EXIT_REFUSED
    );
  }

  const sources: RegistrySource[] = [];
  try {
    const root = await findProjectRoot();
    const config = await loadConfig(root);
    const lock = await loadLock(root);

    const skipped: string[] = [];
    const declarations = await loadDeclarations(
      config,
      lock,
      sources,
      (msg) => {
        skipped.push(msg);
        log.warn(msg, tui);
      }
    );
    if (flagMode) {
      return await writeFlagValues({
        before: await readTarget(root, LOCAL_VALUES),
        declarations,
        opts,
        out,
        root,
      });
    }
    if (declarations.length === 0) {
      if (opts.json) {
        printJson(
          checkReport({ declarations, notInKeyList: [], skipped, values: {} })
        );
      }
      outro(pc.dim("No module declares an environment variable."), tui);
      return EXIT_OK;
    }

    // The key list is `saasaloy add`'s output and every `.env` is written from it, so a
    // key a module declares and the list omits reaches no service at all. `doctor` runs
    // offline and cannot see the descriptors; this command already has them.
    const listed = new Set(
      Object.keys(parseEnvExample((await readTarget(root, ENV_EXAMPLE)) ?? ""))
    );
    const undeclared = declarations
      .filter((declaration) => !listed.has(declaration.name))
      .map((declaration) => declaration.name);
    if (undeclared.length > 0) {
      log.warn(
        `${ENV_EXAMPLE} does not list ${undeclared.join(", ")}, so no service reads ${undeclared.length === 1 ? "it" : "them"}. Re-run \`saasaloy add\` for the declaring module to regenerate the key list.`,
        tui
      );
    }

    // One read of the one file, reused for every variable, so two variables see the same
    // "already set" answer.
    const before = await readTarget(root, LOCAL_VALUES);
    const values = parseEnvValues(before ?? "");

    const pending: Pending[] = declarations
      .filter((declaration) => !isSet(values, declaration.name))
      .map((declaration) => ({ declaration }));

    // The production block is a report, so it prints on every run — a `--check` in CI is
    // exactly where someone wants the deploy commands to hand to an operator.
    const printSecrets = (): void => {
      printSecretCommands(declarations, tui);
    };
    const printReport = (): void => {
      if (opts.json) {
        printJson(
          checkReport({
            declarations,
            notInKeyList: undeclared,
            skipped,
            values,
          })
        );
      }
    };

    if (pending.length === 0) {
      printSecrets();
      printReport();
      outro(pc.green("Every declared variable is set."), tui);
      return EXIT_OK;
    }

    // Prove the file is ignored before asking for a single secret. Typing an API key into
    // a prompt that then refuses to write it wastes the key as much as the typing — and
    // the same refusal is the right answer under `--check`, where it says the deploy gate
    // would have written a secret into a tracked file.
    if (!(await isPathIgnored(root, LOCAL_VALUES))) {
      return out.refuse(NOT_IGNORED, EXIT_REFUSED);
    }

    // `--check` and a session with no terminal take the same path. A prompt nobody can
    // answer is a hang, and a hang in CI is worse than a refusal.
    if (opts.check || !isInteractive()) {
      note(wrapForNote(renderPending(pending).join("\n")), "Missing", tui);
      printSecrets();
      printReport();
      const count = pending.length;
      // The report, not a refusal: under `--json` the document is already on stdout.
      cancel(
        `${count} variable${count === 1 ? "" : "s"} still unset — run \`saasaloy env\` in a terminal, or pass \`--from-file <path>\`, to fill ${count === 1 ? "it" : "them"} in.`,
        tui
      );
      return EXIT_REFUSED;
    }

    const answers: [string, string][] = [];
    for (const entry of pending) {
      // The message is the descriptor's own wording. `env` does not paraphrase it: the
      // module author wrote the sentence that explains what the value is for, and a
      // second wording here would drift from the one in the key list.
      const answer = await text({
        answeredBy: "`--from-file <path>` (or `--set KEY=VALUE`)",
        defaultValue: entry.declaration.devValue ?? "",
        message: `${pc.cyan(entry.declaration.name)} ${pc.dim(`→ ${LOCAL_VALUES}`)}\n${entry.declaration.description}`,
        ...(entry.declaration.devValue === undefined
          ? {}
          : { initialValue: entry.declaration.devValue }),
      });
      if (isCancel(answer)) {
        cancel("Cancelled — nothing written.");
        return EXIT_FAILURE;
      }
      answers.push([entry.declaration.name, answer]);
    }

    const written = await writeAnswers(root, answers, before);
    if (written > 0) {
      note(
        wrapForNote(
          `${pc.cyan(LOCAL_VALUES)} ${pc.dim(`— ${written} added`)}\n\n${pc.dim("Run `pnpm env:setup` to write each service's own .env from it.")}`
        ),
        "Written"
      );
    }
    printSecrets();
    outro(pc.green("Environment filled in."));
    return EXIT_OK;
  } catch (error) {
    return out.fail(error);
  } finally {
    for (const source of sources) {
      await source.cleanup?.();
    }
  }
}
