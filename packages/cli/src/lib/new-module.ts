import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UNKNOWN_VERSION } from "./cli-requires.js";
import { parseVersion } from "./semver.js";

// The scaffold behind `saasaloy new module <name>` (#50).
//
// Authoring a module was Claude-Code-only before this: the `create-module` skill knew the
// shape of a descriptor and nothing else did, which locked out every contributor not
// running that agent. The skeleton is mechanical — a descriptor, a `files/` folder, a
// prefixed skill — so the CLI writes it and the skill keeps the part that is judgment.
//
// One scaffolder, not two. `create-module` now runs this command for the skeleton, so a
// change to the shape lands here and both paths get it.
//
// Everything is pure up to `writeModule`, so the descriptor and the skill are asserted as
// strings in a test with no directory to inspect afterwards.

/** The two tiers a descriptor's `type` may name, in the order the picker offers them. */
export const MODULE_TYPES = [
  "saasaloy:capability",
  "saasaloy:feature",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

/** What each tier is, for the picker's hint and for the refusal that lists them. */
export const TYPE_HINTS: Record<ModuleType, string> = {
  "saasaloy:capability":
    "scaffolds an app or package and establishes an extension point",
  "saasaloy:feature":
    "drops files into the conventions existing capabilities already establish",
};

export function isModuleType(value: string): value is ModuleType {
  return (MODULE_TYPES as readonly string[]).includes(value);
}

// The same pattern `registry-item.schema.json` puts on `name`. Checked before anything is
// written, so a rejected name costs no directory to clean up.
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidModuleName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** Why a name cannot be used, as a sentence, or `undefined` when it can. */
export function nameProblem(name: string): string | undefined {
  return isValidModuleName(name)
    ? undefined
    : `"${name}" isn't a module name — use lowercase letters, digits and hyphens, starting with a letter or digit.`;
}

/** Every module skill folder is prefixed, so two registries' skills never collide (ADR 0014). */
export const SKILL_PREFIX = "saasaloy-";

/** The registry folder a module is written into, relative to the current directory. */
export const REGISTRY_DIR = "modules";

/**
 * The `requires.saasaloy` range a freshly scaffolded descriptor declares, or `undefined`
 * when it should declare none.
 *
 * The floor is the running CLI's own minor, because that is the only version the author
 * has actually run the module against. A wider range would be a claim nobody checked.
 *
 * Two versions produce no range at all. `"unknown"` means the CLI could not read its own
 * package.json, and a floor invented from nothing would refuse every consumer. `0.0.x` is
 * the unpublished placeholder this repo still carries, and `>=0.0` constrains nothing, so
 * the field is left out rather than written as decoration.
 */
export function requiresRange(cliVersion: string): string | undefined {
  if (cliVersion === UNKNOWN_VERSION) {
    return undefined;
  }
  const parsed = parseVersion(cliVersion);
  if (!parsed || (parsed.major === 0 && parsed.minor === 0)) {
    return undefined;
  }
  return `>=${parsed.major}.${parsed.minor}`;
}

export interface ModuleSpec {
  name: string;
  type: ModuleType;
  /** Capabilities this module needs first. Empty means the field is left out entirely. */
  dependsOn: string[];
  /** The `requires.saasaloy` range, from `requiresRange`. Omitted when undefined. */
  requires?: string;
}

/**
 * The descriptor as JSON text.
 *
 * Every optional field the scaffold has nothing to say about is left out rather than
 * written empty. `additionalProperties: false` means a placeholder is a lie the schema
 * cannot catch, and an author deleting `"envVars": {}` is work the scaffold created.
 * Key order follows the schema's own: identity, then requirements, then contents.
 */
export function renderDescriptor(spec: ModuleSpec): string {
  const item: Record<string, unknown> = {
    $schema: "https://saasaloy.dev/schemas/registry-item.schema.json",
    name: spec.name,
    type: spec.type,
  };
  if (spec.requires) {
    item.requires = { saasaloy: spec.requires };
  }
  if (spec.dependsOn.length > 0) {
    item.dependsOn = spec.dependsOn;
  }
  // The skill folder is scaffolded alongside, so the descriptor points at it from the
  // start — a module that ships a runbook nothing references is the easy thing to forget.
  item.agent = { skills: [`skills/${SKILL_PREFIX}${spec.name}`] };
  return `${JSON.stringify(item, null, 2)}\n`;
}

const TIER_WORD: Record<ModuleType, string> = {
  "saasaloy:capability": "capability",
  "saasaloy:feature": "feature",
};

/**
 * The skill stub, in the frontmatter shape every module's `SKILL.md` already uses: a
 * `name` identical to the folder, and a `description` saying when to load it. The body is
 * a checklist of the sections a module runbook owes its reader, because a stub with
 * headings and no prose is easier to finish than a blank page.
 */
export function renderSkill(spec: ModuleSpec): string {
  const tier = TIER_WORD[spec.type];
  const depends =
    spec.dependsOn.length > 0
      ? `It depends on ${spec.dependsOn.join(", ")}, which \`add\` resolves and installs first.`
      : `It declares no \`dependsOn\` yet — add every capability it needs before publishing.`;
  return `---
name: ${SKILL_PREFIX}${spec.name}
description: Runbook for the ${spec.name} module. Use when adding, changing, or debugging ${spec.name} in a Saasaloy project. TODO — describe what this module does and name the files and settings it owns, so the agent loads this on the right task.
---

# ${spec.name} — TODO one-line summary

\`${spec.name}\` is a **${tier} module** (\`${spec.type}\`). ${depends}

TODO — say in two sentences what a consumer gets from installing it.

## What it installs

TODO — list each file this module writes and where it lands. Keep it in step with
\`registry-item.json\`'s \`files[]\`; this table is what a reader checks before editing one.

| File | Lands at |
| --- | --- |
| TODO | TODO |

## Wire-up

Required only when this module targets \`@ui/blocks/\`, because \`add\` writes the block and
never edits a page. Name four things: the file to edit, the import line verbatim, the tag
with its client directive, and a suggested anchor marked as a suggestion. Delete this
section when the module ships no block.

## Settings

TODO — every key in \`envVars\`, what it is for, and what \`saasaloy env\` does with it.
Delete this section when the module declares none.

## What \`remove\` leaves behind

TODO — anything the user has to undo by hand, such as an import they added during wire-up.
`;
}

/** One file the scaffold writes: a module-relative POSIX path and its content. */
export interface ScaffoldedFile {
  path: string;
  content: string;
}

/**
 * Every file the scaffold writes, in the order it writes them. Exported apart from the
 * write so the layout is asserted without a temp directory.
 *
 * `files/.gitkeep` is deliberate: the folder is where the payload goes, and git will not
 * carry an empty directory, so the author would otherwise have to create it themselves
 * before the first file.
 */
export function moduleFiles(spec: ModuleSpec): ScaffoldedFile[] {
  return [
    { content: renderDescriptor(spec), path: "registry-item.json" },
    { content: "", path: "files/.gitkeep" },
    {
      content: renderSkill(spec),
      path: `skills/${SKILL_PREFIX}${spec.name}/SKILL.md`,
    },
  ];
}

/**
 * Write the scaffold under `dir` and return the paths written, module-relative.
 *
 * The caller proves `dir` does not exist first: this refuses to merge into a module folder
 * that is already there, since overwriting a descriptor somebody wrote is not a scaffold.
 */
export async function writeModule(
  dir: string,
  spec: ModuleSpec
): Promise<string[]> {
  const files = moduleFiles(spec);
  for (const file of files) {
    const abs = join(dir, ...file.path.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf-8");
  }
  return files.map((file) => file.path);
}

/**
 * Split a `--depends-on` value into module names. Both `a,b` and `a, b` are accepted, and
 * an empty segment is dropped rather than becoming a `dependsOn` entry named `""` that
 * doctor then reports as a module the registry does not offer.
 */
export function parseDependsOn(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}
