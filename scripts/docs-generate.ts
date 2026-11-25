// Generated reference pages for the docs site (plan 0114, Phase 2).
//
// A fact that lives in code is generated, never written by hand. This script reads the
// files that own the facts and writes Markdown into `docs/wiki/generated/`:
//
//   modules.md           the catalog table of every module in `modules/`
//   modules/<name>.md    one page for each module: descriptor facts, then its skill text
//   env.md               every `envVars` key, with its module and the services that read it
//   cli.md               every command, its usage line and flags, and the exit codes
//   glossary.md          `CONTEXT.md`
//   adr.md               an index of `docs/adr/`
//
//   pnpm docs:generate  → write the files.
//   pnpm docs:check     → regenerate in memory and exit non-zero on any difference, the way
//                         `pnpm deps:check` does. CI runs it, so a descriptor change that
//                         leaves a page stale fails in the pull request that makes it.
//
// The output is deterministic: no timestamp, no commit hash, every list sorted. Every file
// starts with a banner that names this script and says not to edit the file.
//
// Descriptors are read as plain JSON, the way `apps/web/src/lib/module-registry.ts` reads them
// at build time, and the CLI surface is read from the command sources, because the gate runs
// before the CLI is built. `scripts/llms-txt.ts` reads the built CLI's `--help` instead, which
// the release preflight has to do anyway.
//
// Imports node: builtins and a few import-free modules from the CLI and the site. Node 24
// strips the types, so there is no build step.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fenceReader } from "../apps/web/src/lib/docs-fence.ts";
import { DESCRIPTIONS } from "../packages/cli/src/commands/descriptions.ts";
import type { CliSurface } from "./llms-txt.ts";

const GENERATED_DIR = "docs/wiki/generated";
const SCRIPT = "scripts/docs-generate.ts";

// --- Types -------------------------------------------------------------------

interface Descriptor {
  name: string;
  type: string;
  description: string;
  stage: string;
  needs: string[];
  requires: { saasaloy: string };
  dependsOn: string[];
  requiresOneOf: string[];
  conflictsWith: string[];
  envVars: Record<string, string>;
  envOptional: string[];
  envServices: Record<string, string[]>;
  patches: Patch[];
  tables: Table[];
  entries: Row[];
  files: FileEntry[];
  scaffolds: Scaffold[];
  skills: string[];
}

interface Patch {
  file: string;
  kind: string;
}

/** A registration table the module owns: the CLI writes `file` on every run. */
interface Table {
  id: string;
  file: string;
  shape: string;
}

/** A row the module adds to a table. */
interface Row {
  table: string;
}

interface FileEntry {
  target: string;
  when?: string;
  seed?: boolean;
}

interface Scaffold {
  workspace: string;
  aliases: Record<string, string>;
  files: FileEntry[];
}

export type Tier = "capability" | "feature" | "provider" | "driver";

/** The generated files, by repo-relative path, in the order they are written. */
export type Output = Map<string, string>;

// --- Reading -----------------------------------------------------------------

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function field(record: Json, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [
      key,
      typeof item === "string" ? item : "",
    ])
  );
}

function fileEntries(value: unknown): FileEntry[] {
  return records(value).map((record) => {
    const when = field(record, "when");
    return {
      target: field(record, "target"),
      ...(when === "" ? {} : { when }),
      ...(record.seed === true ? { seed: true } : {}),
    };
  });
}

function readDescriptor(root: string, folder: string): Descriptor | undefined {
  const path = join(root, "modules", folder, "registry-item.json");
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = asRecord(JSON.parse(readFileSync(path, "utf-8")));
  const envServices: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(asRecord(raw.envServices))) {
    envServices[key] = strings(list);
  }
  return {
    name: field(raw, "name", folder),
    type: field(raw, "type"),
    description: field(raw, "description"),
    stage: field(raw, "stage"),
    needs: strings(raw.needs),
    requires: { saasaloy: field(asRecord(raw.requires), "saasaloy") },
    dependsOn: strings(raw.dependsOn),
    requiresOneOf: strings(raw.requiresOneOf),
    conflictsWith: strings(raw.conflictsWith),
    envVars: stringMap(raw.envVars),
    envOptional: strings(raw.envOptional),
    envServices,
    patches: records(raw.patches).map((patch) => ({
      file: field(patch, "file"),
      kind: field(patch, "kind"),
    })),
    tables: records(raw.tables).map((owned) => ({
      id: field(owned, "id"),
      file: field(owned, "file"),
      shape: field(owned, "shape"),
    })),
    entries: records(raw.entries).map((row) => ({
      table: field(row, "table"),
    })),
    files: fileEntries(raw.files),
    scaffolds: records(raw.scaffolds).map((scaffold) => ({
      workspace: field(scaffold, "workspace"),
      aliases: stringMap(scaffold.aliases),
      files: fileEntries(scaffold.files),
    })),
    skills: strings(asRecord(raw.agent).skills),
  };
}

function readModules(root: string): Descriptor[] {
  const modules = join(root, "modules");
  return readdirSync(modules)
    .toSorted()
    .map((folder) => readDescriptor(root, folder))
    .filter((item): item is Descriptor => item !== undefined);
}

// --- Markdown helpers --------------------------------------------------------

function banner(source: string): string {
  return `<!-- Generated by ${SCRIPT} from ${source}. Do not edit this file. Run \`pnpm docs:generate\` to update it. -->`;
}

function notice(source: string): string {
  return `> Generated by \`${SCRIPT}\` from ${source}. Do not edit this file. Run \`pnpm docs:generate\` to update it.`;
}

/** One table cell: a pipe would end the cell and a newline would end the row. */
function cell(text: string): string {
  return text
    .replaceAll("|", "\\|")
    .replaceAll(/\s*\n\s*/g, " ")
    .trim();
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function code(text: string): string {
  return `\`${text}\``;
}

/**
 * Rewrites each relative link in `markdown` from one repo file to another: a link written
 * against `fromFile` becomes one written against `toFile`, so it still points at the same
 * repo path from the generated page. Anchors, absolute URLs and a path that names no file
 * stay as written. Links inside code fences stay as written too.
 */
export function rewriteLinks(
  root: string,
  markdown: string,
  fromFile: string,
  toFile: string
): string {
  const inFence = fenceReader();
  return markdown
    .split("\n")
    .map((line) => {
      if (inFence(line)) {
        return line;
      }
      return line.replaceAll(/\]\(([^)\s]+)\)/g, (whole, href: string) => {
        if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
          return whole;
        }
        const [path = "", fragment] = href.split("#");
        const target = posix.normalize(
          posix.join(posix.dirname(fromFile), path)
        );
        if (target.startsWith("..") || !existsSync(join(root, target))) {
          return whole;
        }
        const relative = posix.relative(posix.dirname(toFile), target);
        const rewritten = `${relative === "" ? "." : relative}${path.endsWith("/") ? "/" : ""}`;
        return `](${rewritten}${fragment === undefined ? "" : `#${fragment}`})`;
      });
    })
    .join("\n");
}

/** Demotes every heading outside a code fence by `by` levels, to a ceiling of six. */
function demoteHeadings(markdown: string, by: number): string {
  const inFence = fenceReader();
  return markdown
    .split("\n")
    .map((line) => {
      const heading = inFence(line) ? undefined : /^(#{1,6})(\s.*)$/.exec(line);
      return heading
        ? `${"#".repeat(Math.min(6, (heading[1] ?? "").length + by))}${heading[2] ?? ""}`
        : line;
    })
    .join("\n");
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
}

// --- Module relations --------------------------------------------------------

export function tierOf(item: Descriptor, all: readonly Descriptor[]): Tier {
  if (item.type === "saasaloy:capability") {
    return "capability";
  }
  if (all.some((other) => other.requiresOneOf.includes(item.name))) {
    return "driver";
  }
  const registersProvider = item.entries.some((row) =>
    row.table.endsWith(".providers")
  );
  return registersProvider ? "provider" : "feature";
}

/**
 * The module a provider belongs to: the longest `dependsOn` entry its name starts with, so
 * `email-cloudflare` belongs to `email`. `payment-bkash` depends on `kv` too, but it is not a
 * `kv` provider. The site applies the same rule in apps/web/src/lib/module-catalog.ts.
 */
export function parentOf(item: Descriptor): string | undefined {
  return item.dependsOn
    .filter((name) => item.name.startsWith(`${name}-`))
    .toSorted((a, b) => b.length - a.length)[0];
}

export function implementationsOf(
  item: Descriptor,
  all: readonly Descriptor[]
): { providers: string[]; drivers: string[] } {
  const providers = all
    .filter(
      (other) =>
        parentOf(other) === item.name && tierOf(other, all) === "provider"
    )
    .map((other) => other.name);
  return { providers, drivers: [...item.requiresOneOf] };
}

function moduleLink(
  name: string,
  names: ReadonlySet<string>,
  prefix: string
): string {
  return names.has(name) ? `[${code(name)}](${prefix}${name}.md)` : code(name);
}

function servicesOf(item: Descriptor, key: string): string {
  const declared = item.envServices[key] ?? item.envServices.default;
  if (declared) {
    return declared.join(", ");
  }
  return key.startsWith("PUBLIC_")
    ? "every client service (inferred)"
    : "api (inferred)";
}

// --- saasaloy-* blocks -------------------------------------------------------
//
// The docs site turns a `saasaloy-graph` or `saasaloy-providers` fence into an interactive
// block (apps/web/src/lib/docs-blocks.ts), and it reads the module facts from the
// descriptors itself. The body this script writes is for every other reader: GitHub shows
// it as a code block, and an agent reads the raw page, where the body is the block's data.

/** A tile of the graph: a module that is a capability or a feature, not a provider or driver. */
function graphLines(all: readonly Descriptor[]): string[] {
  const tiles = all.filter((item) => {
    const tier = tierOf(item, all);
    return tier === "capability" || tier === "feature";
  });
  const names = new Set(tiles.map((item) => item.name));
  return tiles.map((item) => {
    const tier = tierOf(item, all);
    const { providers, drivers } = implementationsOf(item, all);
    const parts: [string, string[]][] = [
      ["depends on", item.dependsOn.filter((name) => names.has(name))],
      [
        "used by",
        tiles
          .filter((other) => other.dependsOn.includes(item.name))
          .map((other) => other.name),
      ],
      ["providers", providers],
      ["drivers", drivers],
    ];
    const shown = parts
      .filter(([, list]) => list.length > 0)
      .map(([label, list]) => `${label} ${list.join(", ")}`);
    return `${item.name} (${tier})${shown.length === 0 ? "" : `: ${shown.join("; ")}`}`;
  });
}

/**
 * The env var that picks a provider at runtime, such as `EMAIL_PROVIDER`. A capability
 * whose providers a project does not pick between at runtime (`validators`) has none, and
 * its page shows no providers block.
 */
function selectorOf(item: Descriptor): string | undefined {
  return Object.keys(item.envVars).find((name) => name.endsWith("_PROVIDER"));
}

function providersBlock(
  item: Descriptor,
  providers: string[],
  selector: string
): string {
  const lines = providers.map(
    (name) => `${selector}=${name.slice(item.name.length + 1)}  uses ${name}`
  );
  const lead = /comma list/i.test(item.envVars[selector] ?? "")
    ? `${code(item.name)} picks its providers at runtime with ${code(selector)}, a comma list in priority order. Select providers to see the value to set.`
    : `${code(item.name)} picks its provider at runtime with ${code(selector)}. Select a provider to see the value to set.`;
  return [
    lead,
    [`\`\`\`saasaloy-providers capability=${item.name}`, ...lines, "```"].join(
      "\n"
    ),
  ].join("\n\n");
}

// --- modules.md --------------------------------------------------------------

function catalog(all: readonly Descriptor[]): string {
  const names = new Set(all.map((item) => item.name));
  const rows = all.map((item) => [
    moduleLink(item.name, names, "modules/"),
    tierOf(item, all),
    item.stage,
    item.description,
  ]);
  return `${[
    banner("modules/*/registry-item.json"),
    "# Module catalog",
    notice("every module descriptor in `modules/`"),
    `${all.length} modules in the default registry. Each name links to its page, which holds the descriptor facts and the skill text an agent reads. Run ${code("saasaloy add <name> --dry-run")} to print what a module writes before it writes anything. The tiers are defined in [the glossary](glossary.md).`,
    "## Module dependencies",
    "Select a module to see what it depends on, what depends on it, and its providers or drivers. A provider or a driver shows under its capability or feature.",
    ["```saasaloy-graph", ...graphLines(all), "```"].join("\n"),
    "## Catalog",
    table(["Module", "Tier", "Stage", "What it gives you"], rows),
  ].join("\n\n")}\n`;
}

// --- modules/<name>.md -------------------------------------------------------

function skillText(root: string, item: Descriptor, pageFile: string): string {
  if (item.skills.length === 0) {
    return "This module ships no skill.";
  }
  const parts: string[] = [];
  for (const skill of item.skills) {
    const file = posix.join("modules", item.name, skill, "SKILL.md");
    const path = join(root, file);
    if (!existsSync(path)) {
      throw new Error(
        `${item.name}: agent.skills names ${skill}, which has no SKILL.md`
      );
    }
    const body = stripFrontmatter(readFileSync(path, "utf-8")).trim();
    parts.push(
      `Skill source: ${code(file)}\n\n${demoteHeadings(
        rewriteLinks(root, body, file, pageFile),
        2
      )}`
    );
  }
  return parts.join("\n\n");
}

function scaffoldLines(item: Descriptor): string[] {
  const lines: string[] = [];
  for (const scaffold of item.scaffolds) {
    lines.push(
      `- Workspace ${code(scaffold.workspace)}, ${scaffold.files.length} files.`
    );
    for (const [alias, target] of Object.entries(scaffold.aliases).toSorted(
      ([left], [right]) => (left < right ? -1 : 1)
    )) {
      lines.push(`  - Alias ${code(alias)} points at ${code(target)}.`);
    }
  }
  return lines;
}

function fileLine(entry: FileEntry): string {
  const notes = [
    entry.when === undefined ? "" : `when ${code(entry.when)}`,
    entry.seed === true ? "seed, written once" : "",
  ].filter((note) => note !== "");
  return `- ${code(entry.target)}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}`;
}

function modulePage(
  root: string,
  item: Descriptor,
  all: readonly Descriptor[]
): string {
  const names = new Set(all.map((other) => other.name));
  const pageFile = `${GENERATED_DIR}/modules/${item.name}.md`;
  const list = (items: string[]): string =>
    items.length === 0
      ? "none"
      : items.map((name) => moduleLink(name, names, "")).join(", ");
  const dependents = all
    .filter((other) => other.dependsOn.includes(item.name))
    .map((other) => other.name);
  const { providers, drivers } = implementationsOf(item, all);

  const facts: string[][] = [
    ["Tier", tierOf(item, all)],
    ["Stage", item.stage],
    [
      "Needs",
      item.needs.length === 0
        ? "nothing outside the code"
        : item.needs.map(code).join(", "),
    ],
    [
      "Needs CLI",
      item.requires.saasaloy === "" ? "any" : code(item.requires.saasaloy),
    ],
    ["Depends on", list(item.dependsOn)],
    ["Requires one of", list(item.requiresOneOf)],
    ["Conflicts with", list(item.conflictsWith)],
    ["Depended on by", list(dependents)],
  ];
  if (providers.length > 0) {
    facts.push(["Providers", list(providers)]);
  }
  if (drivers.length > 0) {
    facts.push(["Drivers", list(drivers)]);
  }

  const sections: string[] = [
    banner(`modules/${item.name}/registry-item.json and its skill`),
    `# ${item.name}`,
    notice(`${code(`modules/${item.name}/registry-item.json`)} and its skill`),
    item.description,
    "## Facts",
    table(["Field", "Value"], facts),
  ];
  const selector = selectorOf(item);
  if (
    tierOf(item, all) === "capability" &&
    providers.length > 0 &&
    selector !== undefined
  ) {
    sections.push("## Providers", providersBlock(item, providers, selector));
  }

  const keys = Object.keys(item.envVars).toSorted();
  const envSection =
    keys.length === 0
      ? "This module declares no environment variables."
      : table(
          ["Variable", "Services", "Optional", "What it does"],
          keys.map((key) => [
            code(key),
            servicesOf(item, key),
            item.envOptional.includes(key) ? "yes" : "no",
            item.envVars[key] ?? "",
          ])
        );

  const writes: string[] = [...scaffoldLines(item)];
  if (item.files.length > 0) {
    writes.push("Files:", ...item.files.map(fileLine));
  }

  const patches = item.patches.map((patch) => [
    code(patch.file),
    code(patch.kind),
  ]);
  const owned = item.tables.map((held) => [
    code(held.id),
    code(held.file),
    code(held.shape),
  ]);
  const rowCounts = new Map<string, number>();
  for (const row of item.entries) {
    rowCounts.set(row.table, (rowCounts.get(row.table) ?? 0) + 1);
  }
  const rows = [...rowCounts].map(([id, count]) => [code(id), String(count)]);

  sections.push(
    "## Environment variables",
    envSection,
    "## Files and workspaces it writes",
    writes.length === 0
      ? "This module writes no file of its own."
      : writes.join("\n"),
    "## Patches it applies",
    patches.length === 0
      ? "This module patches no file."
      : table(["File", "Kind"], patches),
    "## Tables it owns",
    owned.length === 0
      ? "This module owns no registration table."
      : `The CLI writes each table in full on every run, from the rows of the installed modules.\n\n${table(["Table", "Generated file", "Shape"], owned)}`,
    "## Rows it adds to tables",
    rows.length === 0
      ? "This module adds no row to a table."
      : table(["Table", "Rows"], rows),
    "## See the rest",
    `Run ${code(`saasaloy add ${item.name} --dry-run`)} to print every file and patch the module writes, in install order, and write nothing.`,
    "## What your agent reads",
    skillText(root, item, pageFile)
  );
  return `${sections.join("\n\n")}\n`;
}

// --- env.md ------------------------------------------------------------------

function envPage(all: readonly Descriptor[]): string {
  const names = new Set(all.map((item) => item.name));
  const rows: { key: string; row: string[] }[] = [];
  for (const item of all) {
    for (const [key, text] of Object.entries(item.envVars)) {
      rows.push({
        key,
        row: [
          code(key),
          moduleLink(item.name, names, "modules/"),
          servicesOf(item, key),
          item.envOptional.includes(key) ? "yes" : "no",
          text,
        ],
      });
    }
  }
  rows.sort(
    (a, b) =>
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.row[1] ?? "").localeCompare(b.row[1] ?? "")
  );
  return `${[
    banner("the envVars of modules/*/registry-item.json"),
    "# Environment variables of the modules",
    notice(
      "the `envVars`, `envServices` and `envOptional` fields of every descriptor"
    ),
    `Every module declares the values it reads in its descriptor. ${code("saasaloy env")} collects them into ${code("packages/env/.env")}, and each service reads the keys named in its Services column. A key with no declared services falls back to the ${code("PUBLIC_")} prefix rule, and the table marks it inferred. The environment of the CLI itself is on [the reference page](../reference.md#environment-variables).`,
    `${rows.length} variables.`,
    table(
      ["Variable", "Module", "Services", "Optional", "What it does"],
      rows.map((entry) => entry.row)
    ),
  ].join("\n\n")}\n`;
}

// --- cli.md ------------------------------------------------------------------

const EXIT_MEANINGS: Record<string, string> = {
  EXIT_OK:
    "the command did what it was asked, or you answered no to a confirmation",
  EXIT_FAILURE:
    "something failed, or you cancelled: a fetch died, a write threw, Ctrl-C",
  EXIT_REFUSED:
    "saasaloy refused by design: an unknown flag or command, a module conflict, an unmet `requiresOneOf`, an invalid state file, a `doctor` or `env --check` finding, or a prompt with no terminal to answer it in",
  EXIT_WORK_PENDING:
    "`saasaloy update` only: the run applied what it could and left work pending, such as files waiting on a merge or update notes not yet marked done",
};

function arrayConstant(root: string, file: string, name: string): string[] {
  const text = readFileSync(join(root, file), "utf-8");
  const body = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(
    text
  )?.[1];
  if (body === undefined) {
    throw new Error(`${file}: cannot read ${name}`);
  }
  return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** A string or template literal from a command source, with `${NAME.join("x")}` resolved. */
function literal(text: string, constants: Record<string, string[]>): string {
  const body = text.slice(1, -1);
  const resolved = body.replaceAll(
    /\$\{(\w+)\.join\((["'`])(.*?)\2\)\}/g,
    (_whole, name: string, _quote: string, separator: string) => {
      const values = constants[name];
      if (values === undefined) {
        throw new Error(`cli.md: unknown constant ${name} in a command help`);
      }
      return values.join(separator);
    }
  );
  if (resolved.includes("${")) {
    throw new Error(`cli.md: unresolved template in ${text}`);
  }
  return resolved.replaceAll(/\\(["`\\])/g, "$1");
}

interface CommandSurface {
  usage: string;
  flags: [string, string][];
}

function commandSurface(
  root: string,
  command: string,
  constants: Record<string, string[]>
): CommandSurface {
  const file = `packages/cli/src/commands/${command}.ts`;
  const source = readFileSync(join(root, file), "utf-8");
  const usage = /const USAGE =\s*("(?:[^"\\]|\\.)*"|`[^`]*`);/.exec(
    source
  )?.[1];
  const help = /const HELP: CommandHelp = \{([\s\S]*?)\n\};/.exec(source)?.[1];
  const flagBlock = /flags: \{([\s\S]*?)\n? {0,2}\},/.exec(help ?? "")?.[1];
  if (usage === undefined || flagBlock === undefined) {
    throw new Error(`${file}: cannot read the USAGE line or the HELP flags`);
  }
  const flags = [
    ...flagBlock.matchAll(/^ {4}"([^"]+)":\s*("(?:[^"\\]|\\.)*"|`[^`]*`),?$/gm),
  ].map((match): [string, string] => [
    match[1] ?? "",
    literal(match[2] ?? "", constants),
  ]);
  return { usage: literal(usage, constants), flags };
}

function surfaceConstants(root: string): Record<string, string[]> {
  return {
    TESTING_MODES: arrayConstant(
      root,
      "packages/cli/src/lib/testing.ts",
      "TESTING_MODES"
    ),
    THEME_NAMES: arrayConstant(
      root,
      "packages/cli/src/lib/theme-names.ts",
      "THEME_NAMES"
    ),
    TEMPLATE_NAMES: arrayConstant(
      root,
      "packages/cli/src/lib/recipes.ts",
      "TEMPLATE_NAMES"
    ),
    MODULE_TYPES: arrayConstant(
      root,
      "packages/cli/src/lib/new-module.ts",
      "MODULE_TYPES"
    ),
  };
}

/**
 * The CLI's commands and each command's flags, read from the sources the way `cli.md` is,
 * so a check can run before the CLI is built. `saasaloy` itself takes `-h`, `--help`, `-v`
 * and `--version` (`packages/cli/src/cli.ts`).
 */
export function sourceCliSurface(root: string): CliSurface {
  const constants = surfaceConstants(root);
  const commands = new Map<string, Set<string>>();
  for (const name of Object.keys(DESCRIPTIONS)) {
    const flags = new Set(["-h", "--help"]);
    for (const [column] of commandSurface(root, name, constants).flags) {
      for (const part of column.split(", ")) {
        flags.add(part.split(/[= ]/)[0] ?? part);
      }
    }
    commands.set(name, flags);
  }
  return {
    commands,
    globalFlags: new Set(["-h", "--help", "-v", "--version"]),
  };
}

function cliPage(root: string): string {
  const constants = surfaceConstants(root);
  const commands = Object.entries(DESCRIPTIONS) as [string, string][];
  const exits = [
    ...readFileSync(
      join(root, "packages/cli/src/lib/exit.ts"),
      "utf-8"
    ).matchAll(/^export const (EXIT_[A-Z_]+) = (\d+);/gm),
  ].map((match) => [match[1] ?? "", match[2] ?? ""] as const);

  const exitRows = exits.map(([name, value]) => {
    const meaning = EXIT_MEANINGS[name];
    if (meaning === undefined) {
      throw new Error(`cli.md: exit code ${name} has no meaning in ${SCRIPT}`);
    }
    return [code(value), code(name), meaning];
  });

  const sections: string[] = [
    banner("packages/cli/src/commands/ and packages/cli/src/lib/exit.ts"),
    "# CLI commands",
    notice(
      "the command sources under `packages/cli/src/commands/` and `packages/cli/src/lib/exit.ts`"
    ),
    `${commands.length} commands. Every command answers ${code("--help")} with its usage and flags. The behavior of each command, its JSON output and the coordinate grammar are on [the reference page](../reference.md).`,
    "```text\nsaasaloy <command> [options]\n```",
    table(
      ["Command", "What it does"],
      commands.map(([name, text]) => [code(name), text])
    ),
    "## Exit codes",
    table(["Code", "Name", "Meaning"], exitRows),
  ];
  for (const [name] of commands) {
    const surface = commandSurface(root, name, constants);
    sections.push(
      `## ${code(`saasaloy ${name}`)}`,
      `\`\`\`text\n${surface.usage}\n\`\`\``,
      table(
        ["Flag", "Effect"],
        [
          ...surface.flags,
          ["-h, --help", "show this help"] as [string, string],
        ].map(([flag, text]) => [code(flag), text])
      )
    );
  }
  return `${sections.join("\n\n")}\n`;
}

// --- glossary.md -------------------------------------------------------------

function glossaryPage(root: string): string {
  const pageFile = `${GENERATED_DIR}/glossary.md`;
  const text = readFileSync(join(root, "CONTEXT.md"), "utf-8");
  const body = text.replace(/^# .*\n/, "").trim();
  return `${[
    banner("CONTEXT.md"),
    "# Glossary",
    notice("`CONTEXT.md`, the ubiquitous language of the project"),
    demoteHeadings(rewriteLinks(root, body, "CONTEXT.md", pageFile), 0),
  ].join("\n\n")}\n`;
}

// --- adr.md ------------------------------------------------------------------

function adrPage(root: string): string {
  const dir = join(root, "docs", "adr");
  const rows = readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .toSorted()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf-8");
      const heading = /^# (.*)$/m.exec(text)?.[1] ?? file;
      const title = heading.replace(/^\d+\s*(?:—|:|-)\s*/, "");
      const status =
        /^## Status\s*\n+([A-Za-z]+)/m.exec(text)?.[1]?.toLowerCase() ??
        "not stated";
      const number = /^(?:adr-)?(\d+)/.exec(file)?.[1] ?? "";
      return [number, `[${cell(title)}](../../adr/${file})`, status];
    });
  return `${[
    banner("docs/adr/"),
    "# Architecture decision records",
    notice("the files in `docs/adr/`"),
    `${rows.length} records. Each one states a decision that is hard to reverse, and the reason. A record that amends or supersedes another says so in its Status section.`,
    table(["Number", "Decision", "Status"], rows),
  ].join("\n\n")}\n`;
}

// --- Entry points ------------------------------------------------------------

/** Every generated file, as repo-relative path to content. Reads `root`, writes nothing. */
export function generate(root: string): Output {
  const all = readModules(root);
  return new Map([
    [`${GENERATED_DIR}/modules.md`, catalog(all)],
    ...all.map((item): [string, string] => [
      `${GENERATED_DIR}/modules/${item.name}.md`,
      modulePage(root, item, all),
    ]),
    [`${GENERATED_DIR}/env.md`, envPage(all)],
    [`${GENERATED_DIR}/cli.md`, cliPage(root)],
    [`${GENERATED_DIR}/glossary.md`, glossaryPage(root)],
    [`${GENERATED_DIR}/adr.md`, adrPage(root)],
  ]);
}

function listGenerated(root: string, dir = GENERATED_DIR): string[] {
  const path = join(root, dir);
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listGenerated(root, posix.join(dir, entry.name))
      : [posix.join(dir, entry.name)]
  );
}

/** The paths that differ from `output` on disk: stale, missing, or not generated at all. */
export function stalePaths(root: string, output: Output): string[] {
  const stale: string[] = [];
  for (const [path, content] of output) {
    const file = join(root, path);
    if (!existsSync(file) || readFileSync(file, "utf-8") !== content) {
      stale.push(path);
    }
  }
  for (const path of listGenerated(root)) {
    if (!output.has(path)) {
      stale.push(path);
    }
  }
  return stale.toSorted();
}

export function writeGenerated(root: string, output: Output): void {
  for (const path of listGenerated(root)) {
    if (!output.has(path)) {
      // An orphan, such as a page of a module removed since the last run.
      rmSync(join(root, path), { force: true });
    }
  }
  for (const [path, content] of output) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function main(argv: string[]): number {
  const root = resolve(import.meta.dirname, "..");
  const output = generate(root);
  if (argv.includes("--check")) {
    const stale = stalePaths(root, output);
    if (stale.length === 0) {
      console.log(`docs:check: ${output.size} generated pages are current.`);
      return 0;
    }
    console.error(
      `docs:check: ${stale.length} generated page(s) differ from their source:\n${stale
        .map((path) => `  ${path}`)
        .join("\n")}\nRun \`pnpm docs:generate\` and commit the result.`
    );
    return 1;
  }
  writeGenerated(root, output);
  console.log(
    `docs:generate: wrote ${output.size} pages to ${GENERATED_DIR}/.`
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
