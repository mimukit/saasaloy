import { findNodeAtLocation, getNodeValue, parseTree } from "jsonc-parser";
import { parseModule } from "magicast";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { BASE_MODULE, baseEntries, isBaseTracked } from "./base.js";
import { ENV_EXAMPLE } from "./env-example.js";
import {
  hashContent,
  joinModulePath,
  pathExists,
  readDirNames,
  readIfPresent,
  resolveWithinRoot,
} from "./fs-utils.js";
import type { LockBase, Lockfile } from "./lock.js";
import type { Manifest } from "./manifest.js";
import { entryValue, findConstArray } from "./patch/ts-array.js";
import type { Program } from "./patch/ts-array.js";
import type { ModuleImports } from "./patch/ts-ast.js";
import { ROOT_MANIFEST, withRootVersion } from "./root-version.js";
import { loadConfig } from "./saasaloy-config.js";
import { baseTemplateDir } from "./scaffold.js";
import { isValidRange } from "./semver.js";
import { validateRegistryItem } from "./schema.js";
import type { SaasaloyConfig } from "./schema.js";

// The checks behind `saasaloy doctor`. Split from the command so the rules are testable
// without a terminal, and so a future `doctor owner/repo/name` (the consumer path, a
// follow-up) can reuse them against a downloaded folder.
//
// Everything here is local: a module folder, its siblings in the same registry, and the
// alias map the base template establishes. Nothing is fetched, so an author can run it
// before publishing rather than finding out on a stranger's machine.
//
// `checkProject` at the foot of the file reads the other side — a consumer project's own
// state files — and is the one check here that says nothing about a descriptor.

export interface Finding {
  /** The module folder the finding belongs to. */
  module: string;
  /**
   * Where inside the descriptor, in the shape ajv prints (`/files/0/target`). A project
   * check points into the project's own state instead, e.g. `/installed/waitlist`.
   */
  where: string;
  message: string;
}

export interface ModuleReport {
  module: string;
  /** Absolute path of the module folder. */
  dir: string;
  findings: Finding[];
}

/** The aliases a descriptor's `files[].target` may name. */
export interface AliasSources {
  /** `@web`, `@ui` — established by `saasaloy init`, before any module applies. */
  base: Record<string, string>;
  /** Every alias a scaffold in this registry registers, e.g. `@api` from the api module. */
  fromScaffolds: Record<string, string>;
}

// Every skill folder a module ships is prefixed, so two registries' skills can sit in one
// `.claude/skills/` without colliding (ADR 0014).
const SKILL_PREFIX = "saasaloy-";

// `dependencies` and `devDependencies` are exact-pinned `name@version` (ADR 0017). The
// schema enforces the same shape; this repeats it so the report says what is wrong with
// the entry rather than only that a pattern did not match.
const PINNED_DEP = /^(@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;

function finding(module: string, where: string, message: string): Finding {
  return { message, module, where };
}

// The descriptor is parsed before the schema has vouched for it — that is the point of
// doctor — so every field read below goes through one of these instead of a cast the
// JSON can violate. A wrong-shaped field reads as absent here and the schema pass names
// it; iterating `"scaffolds": {}` directly would throw and swallow the whole report.
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Names of the module folders under `dir` — a folder counts when it carries a descriptor,
 * the same rule `LocalRegistrySource.listModules` uses.
 */
export async function registryModuleNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const name of await readDirNames(dir)) {
    if (await pathExists(join(dir, name, "registry-item.json"))) {
      names.push(name);
    }
  }
  return names.toSorted();
}

/**
 * The alias map a descriptor in `registryDir` may target. The base template's own
 * `saasaloy.json` supplies the aliases every project starts with; each capability's
 * `scaffolds[].aliases` supplies the ones a project gains by installing it.
 */
export async function collectAliases(
  registryDir: string,
  names: string[]
): Promise<AliasSources> {
  const templateDir = await baseTemplateDir();
  let base: Record<string, string> = {};
  if (await pathExists(join(templateDir, "saasaloy.json"))) {
    base = (await loadConfig(templateDir)).aliases;
  }

  const fromScaffolds: Record<string, string> = {};
  for (const name of names) {
    const item = asRecord(await readDescriptor(join(registryDir, name)));
    for (const scaffold of asArray(item.scaffolds)) {
      const aliases = asRecord(asRecord(scaffold).aliases);
      for (const [alias, prefix] of Object.entries(aliases)) {
        if (typeof prefix === "string") {
          fromScaffolds[alias] = prefix;
        }
      }
    }
  }
  return { base, fromScaffolds };
}

/** Parse a module folder's descriptor, or `undefined` when it is missing or unreadable. */
async function readDescriptor(dir: string): Promise<unknown> {
  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

export interface CheckModuleInput {
  /** Absolute path of the module folder. */
  dir: string;
  /** Every module name the surrounding registry offers, for `dependsOn` resolution. */
  siblings: string[];
  aliases: AliasSources;
}

/**
 * Every violation one module folder carries. Schema errors and structural errors are
 * reported together rather than the schema pass short-circuiting: an author fixing a
 * descriptor wants the whole list, not the first line of it.
 */
export async function checkModule(
  input: CheckModuleInput
): Promise<ModuleReport> {
  const { aliases, dir, siblings } = input;
  const module = basename(dir);
  const findings: Finding[] = [];
  const report = (): ModuleReport => ({ dir, findings, module });

  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    findings.push(
      finding(module, "(root)", `no registry-item.json in ${module}/`)
    );
    return report();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch (error) {
    findings.push(
      finding(
        module,
        "(root)",
        `registry-item.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return report();
  }

  const schema = await validateRegistryItem(parsed);
  const schemaFindings = schema.errors.map((error) => {
    const [where, ...rest] = error.split(": ");
    return finding(module, where ?? "(root)", rest.join(": "));
  });

  // The structural checks below read the parsed object even when the schema rejected it.
  // A descriptor usually fails on one property, and reporting only that hides the
  // missing file or the unknown alias the author would fix in the same pass.
  const item = asRecord(parsed);

  if (typeof item.name === "string" && item.name !== module) {
    findings.push(
      finding(
        module,
        "/name",
        `declares name "${item.name}" — the folder and the descriptor name must match`
      )
    );
  }

  const known = { ...aliases.base, ...aliases.fromScaffolds };
  const knownList = Object.keys(known).toSorted().join(", ") || "(none)";
  for (const [index, entry] of asArray(item.files).entries()) {
    await checkSourcePath(findings, module, dir, `/files/${index}/path`, entry);
    const target = asRecord(entry).target;
    const alias = typeof target === "string" ? target.split("/")[0] : undefined;
    if (alias && !(alias in known)) {
      findings.push(
        finding(
          module,
          `/files/${index}/target`,
          `unknown alias "${alias}" in "${String(target)}" — known aliases: ${knownList}`
        )
      );
    }
  }

  for (const [index, scaffold] of asArray(item.scaffolds).entries()) {
    for (const [fileIndex, entry] of asArray(
      asRecord(scaffold).files
    ).entries()) {
      await checkSourcePath(
        findings,
        module,
        dir,
        `/scaffolds/${index}/files/${fileIndex}/path`,
        entry
      );
    }
  }

  const siblingSet = new Set(siblings);

  // Every `when` (#242): each `installed` name is a module this registry offers, or the
  // entry can never ship; and `testing` is only `true`. The schema rejects any other
  // `testing` value too, as a bare "must be equal to constant", so this says it plainly.
  const whens: [string, unknown][] = [
    ...asArray(item.files).map((entry, index): [string, unknown] => [
      `/files/${index}/when`,
      asRecord(entry).when,
    ]),
    ...asArray(item.scaffolds).flatMap((scaffold, index) =>
      asArray(asRecord(scaffold).files).map(
        (entry, fileIndex): [string, unknown] => [
          `/scaffolds/${index}/files/${fileIndex}/when`,
          asRecord(entry).when,
        ]
      )
    ),
    ...asArray(item.patches).map((entry, index): [string, unknown] => [
      `/patches/${index}/when`,
      asRecord(entry).when,
    ]),
  ];
  for (const [where, when] of whens) {
    if (when === undefined) {
      continue;
    }
    const testing = asRecord(when).testing;
    if (testing !== undefined && testing !== true) {
      findings.push(
        finding(
          module,
          `${where}/testing`,
          `is ${JSON.stringify(testing)} — the only value is true; leave the key out for an entry that ships in every mode`
        )
      );
    }
    for (const [index, name] of asArray(asRecord(when).installed).entries()) {
      if (typeof name === "string" && !siblingSet.has(name)) {
        findings.push(
          finding(
            module,
            `${where}/installed/${index}`,
            `names "${name}", which this registry does not offer, so the entry never ships`
          )
        );
      }
    }
  }

  for (const [field, names] of [
    ["dependsOn", item.dependsOn],
    ["requiresOneOf", item.requiresOneOf],
    ["conflictsWith", item.conflictsWith],
  ] as const) {
    for (const [index, name] of asArray(names).entries()) {
      if (typeof name === "string" && !siblingSet.has(name)) {
        findings.push(
          finding(
            module,
            `/${field}/${index}`,
            `names "${name}", which this registry does not offer`
          )
        );
      }
    }
  }

  for (const [field, deps] of [
    ["dependencies", item.dependencies],
    ["devDependencies", item.devDependencies],
  ] as const) {
    for (const [index, dep] of asArray(deps).entries()) {
      if (typeof dep === "string" && !PINNED_DEP.test(dep)) {
        findings.push(
          finding(
            module,
            `/${field}/${index}`,
            `"${dep}" is not exact-pinned — write it as name@1.2.3 (ADR 0017; \`pnpm deps:update\` fills the version)`
          )
        );
      }
    }
  }

  // `requires.saasaloy` is checked structurally only: is it a string, and is it a range
  // this CLI can evaluate (#50). It is deliberately *not* compared against the running
  // version — doctor is the author's tool, and a registry author's CLI is not the
  // consumer's. An author on 0.9 writing `>=2` for a field landing next quarter is right,
  // and a doctor that failed them for it would teach them to stop declaring the field.
  const requires = asRecord(item.requires).saasaloy;
  if (requires !== undefined) {
    if (typeof requires !== "string") {
      findings.push(
        finding(
          module,
          "/requires/saasaloy",
          `must be a semver range string, not ${Array.isArray(requires) ? "an array" : typeof requires}`
        )
      );
    } else if (!isValidRange(requires)) {
      findings.push(
        finding(
          module,
          "/requires/saasaloy",
          `"${requires}" isn't a semver range — write one like ">=0.3", ">=0.3 <2", "^1.2.0" or "1.x"`
        )
      );
    }
  }

  // Every `envServices` key other than `default` names a variable this module declares.
  // A typo there routes nothing, and the `PUBLIC_` fallback then decides silently.
  for (const key of Object.keys(asRecord(item.envServices))) {
    if (key !== "default" && !(key in asRecord(item.envVars))) {
      findings.push(
        finding(
          module,
          `/envServices/${key}`,
          "has no matching entry in envVars, so it routes nothing"
        )
      );
    }
  }

  // Every `envOptional` name is a variable this module declares. A typo there leaves the
  // key without its `# Blank on purpose` line, and `pnpm env:setup` then fails on it.
  for (const key of asArray(item.envOptional)) {
    if (typeof key === "string" && !(key in asRecord(item.envVars))) {
      findings.push(
        finding(
          module,
          `/envOptional/${key}`,
          "has no matching entry in envVars, so nothing marks it blank on purpose"
        )
      );
    }
  }

  // Every `devVars` key is a local value for an env var the module declares. A key with
  // no `envVars` entry is written to nothing, which the schema documents and cannot check.
  for (const key of Object.keys(asRecord(item.devVars))) {
    if (!(key in asRecord(item.envVars))) {
      findings.push(
        finding(
          module,
          `/devVars/${key}`,
          `has no matching entry in envVars, so nothing describes it`
        )
      );
    }
  }

  for (const [index, skill] of asArray(asRecord(item.agent).skills).entries()) {
    if (typeof skill !== "string") {
      continue;
    }
    const folder = posix.basename(skill);
    if (!folder.startsWith(SKILL_PREFIX)) {
      findings.push(
        finding(
          module,
          `/agent/skills/${index}`,
          `skill folder "${folder}" must start with "${SKILL_PREFIX}" (ADR 0014)`
        )
      );
    }
    const missing = await missingModulePath(dir, skill);
    if (missing) {
      findings.push(
        finding(
          module,
          `/agent/skills/${index}`,
          missing === "escape"
            ? `"${skill}" escapes the module folder`
            : `no such folder: ${skill}`
        )
      );
    }
  }

  // Schema errors come first, minus any the checks above already explained better at the
  // same path. An unpinned dependency fails a schema pattern *and* a rule here; printing
  // both leaves the author reading a raw regex next to the sentence that answers it.
  const explained = new Set(findings.map((found) => found.where));
  findings.unshift(
    ...schemaFindings.filter((found) => !explained.has(found.where))
  );

  return report();
}

async function checkSourcePath(
  findings: Finding[],
  module: string,
  dir: string,
  where: string,
  entry: unknown
): Promise<void> {
  const path = asRecord(entry).path;
  if (typeof path !== "string" || path === "") {
    return;
  }
  const missing = await missingModulePath(dir, path);
  if (missing) {
    findings.push(
      finding(
        module,
        where,
        missing === "escape"
          ? `"${path}" escapes the module folder — the applier refuses this descriptor`
          : `no such file: ${path}`
      )
    );
  }
}

/**
 * Whether a descriptor-authored path is absent under the module folder, and why. The
 * applier resolves the same paths through `joinModulePath`, so a `../` that slips past
 * doctor here would be reported present and then refused on a stranger's machine.
 */
async function missingModulePath(
  dir: string,
  relPosix: string
): Promise<false | "absent" | "escape"> {
  let abs: string;
  try {
    abs = joinModulePath(dir, relPosix);
  } catch {
    return "escape";
  }
  return (await pathExists(abs)) ? false : "absent";
}

export interface ProjectCheckArgs {
  config: SaasaloyConfig;
  manifest: Manifest;
}

/**
 * The one project-state rule (#107): a module `saasaloy.json` lists as installed that owns
 * no file in `.saasaloy/manifest.json`. `add` warns once when it reclaims a target whose
 * file was hand-deleted, and that warning scrolls away; this is how the state stays
 * findable afterwards. The inverse — files tracked for a module that is not installed —
 * is `checkPartialInstalls` below (#49).
 *
 * Already-loaded state comes in rather than a root path, so the rule tests with plain
 * objects like the descriptor rules above it. `config.base` is not walked, so the base app
 * can never be reported.
 */
export function checkProject(args: ProjectCheckArgs): Finding[] {
  const { config, manifest } = args;
  const owners = new Set(
    Object.values(manifest.managed).map((entry) => entry.module)
  );
  // `managed` is the file ledger, and the criterion is about files. A module owning a
  // patch or a link but no file is still a module that owns no files.
  return config.installed
    .filter((name) => !owners.has(name))
    .map((name) =>
      finding(
        name,
        "/installed",
        `installed but owns no files in .saasaloy/manifest.json — run \`saasaloy remove ${name}\` to drop it.`
      )
    );
}

// ---------------------------------------------------------------------------
// The rate limit policy rule (#129).
// ---------------------------------------------------------------------------

/** Where `kv` keeps its registry, and the file the `plugin-array` patches write into. */
export const KV_INDEX_FILE = "packages/kv/src/index.ts";
/** The Worker config `kv-cloudflare` puts its `ratelimits` entries in. */
export const WRANGLER_FILE = "apps/api/wrangler.jsonc";
/** The provider whose limiter needs a binding per policy. Without it there is nothing to check. */
const CLOUDFLARE_KV_MODULE = "kv-cloudflare";

export interface PolicyBindingArgs {
  /** The source of `packages/kv/src/index.ts`. */
  index: string;
  /** Import specifier, exactly as `index.ts` writes it, → that module's source. */
  policySources: Record<string, string>;
  /** The source of `apps/api/wrangler.jsonc`. */
  wrangler: string;
}

/**
 * Every registered rate limit policy whose `RL_<NAME>` binding is missing from
 * `wrangler.jsonc` (#129).
 *
 * **Names only, never numbers.** A policy's `limit` and `periodSeconds` in
 * `policies/ratelimit.ts` and the `limit`/`period` in `wrangler.jsonc` are two separate
 * numbers that Cloudflare never reconciles, and the one that applies is the Worker
 * config's. Editing only the TypeScript changes nothing on Cloudflare, and that drift is
 * documented in the `saasaloy-ratelimit` skill rather than checked here: a project is
 * entitled to run `kv-memory` on a tighter budget than it deploys with. A *missing*
 * binding is different — `consume` throws `not_supported` on the first request through
 * the route, which is a broken deploy rather than a preference.
 *
 * The policy array is read the same way the `plugin-array` patch writes it: through
 * magicast, off `export const kv = defineKv({ policies: [...] })`. Two element shapes
 * carry a name. An inline `definePolicy({ name: "burst", ... })` holds it in its own
 * first argument. A bare factory call holds it in the `definePolicy({ name })` literal in
 * the file that call is imported from — there the callee is not the name
 * (`defaultPolicy()` registers `"default"`, because `default` is a reserved word).
 *
 * An element in neither shape is reported rather than skipped. A silent skip is the worse
 * answer: `doctor` would print "No problems found" for a policy that throws
 * `not_supported` on the first request.
 */
export function checkPolicyBindings(args: PolicyBindingArgs): Finding[] {
  const bound = new Set(rateLimitBindingNames(args.wrangler));
  const findings: Finding[] = [];

  for (const entry of registeredPolicies(args)) {
    if (entry.name === undefined) {
      findings.push(
        finding(
          "ratelimit",
          `/policies/${String(entry.index)}`,
          `the policy at index ${String(entry.index)} of the \`policies\` array in ` +
            `${KV_INDEX_FILE} has no name this check can read, so its RL_<NAME> binding ` +
            `in ${WRANGLER_FILE} was not checked. Write it as ` +
            `\`definePolicy({ name: "..." })\`, or as a factory exported from a file ` +
            `under packages/kv/src/policies/.`
        )
      );
      continue;
    }
    if (!bound.has(bindingFor(entry.name))) {
      findings.push(
        finding(
          "ratelimit",
          `/policies/${entry.name}`,
          `policy "${entry.name}" has no ${bindingFor(entry.name)} entry in ${WRANGLER_FILE} — ` +
            `consume({ policy: "${entry.name}" }) throws not_supported on the first request. ` +
            `Add the binding, or drop the policy from ${KV_INDEX_FILE}.`
        )
      );
    }
  }

  return findings;
}

function bindingFor(policy: string): string {
  return `RL_${policy.toUpperCase()}`;
}

/** The `name` of every entry in wrangler.jsonc's top-level `ratelimits` array. */
function rateLimitBindingNames(wrangler: string): string[] {
  const root = parseTree(wrangler);
  if (!root) {
    return [];
  }
  const node = findNodeAtLocation(root, ["ratelimits"]);
  if (node?.type !== "array") {
    return [];
  }
  const names: string[] = [];
  for (const child of node.children ?? []) {
    const value: unknown = getNodeValue(child);
    const name = asRecord(value).name;
    if (typeof name === "string") {
      names.push(name);
    }
  }
  return names;
}

/** One element of the `policies` array: its index, and its name when one can be read. */
interface RegisteredPolicy {
  index: number;
  name: string | undefined;
}

/** Every element of the `policies` array, in registration order. */
function registeredPolicies(args: PolicyBindingArgs): RegisteredPolicy[] {
  let mod;
  try {
    mod = parseModule(args.index);
  } catch {
    return [];
  } // unparseable — `add` would have refused it, and this rule is not the place to say so

  const callArg = mod.exports.kv?.$args?.[0];
  const array: unknown = callArg?.policies;
  if (!Array.isArray(array)) {
    return [];
  }

  const imports = mod.imports as unknown as ModuleImports;
  const policies: RegisteredPolicy[] = [];
  // Indexed, not for-of: magicast's array proxy hands raw AST nodes to an iterator and
  // the wrapped proxy (with `$callee`) only to an index read. ts-module.ts does the same.
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let i = 0; i < array.length; i++) {
    const element: unknown = array[i];
    policies.push({ index: i, name: policyNameOf(element, args, imports) });
  }
  return policies;
}

/** The name an element of the `policies` array registers, in either shape. */
function policyNameOf(
  element: unknown,
  args: PolicyBindingArgs,
  imports: ModuleImports
): string | undefined {
  const callee = calleeName(element);
  if (callee === undefined) {
    return undefined;
  }

  // Shape one: the call is `definePolicy({ name: "burst", ... })` right here, which is
  // the shape `define.ts`'s docblock and `index.ts`'s comment both show.
  const inline = inlineNameArgument(element);
  if (inline !== undefined) {
    return inline;
  }

  // Shape two: a bare factory call, whose name lives in the file it is imported from.
  const from = imports[callee]?.from;
  const source =
    typeof from === "string" ? args.policySources[from] : undefined;
  return source === undefined ? undefined : policyNameIn(source, callee);
}

/** The `name` string literal in the first argument of a magicast function-call proxy. */
function inlineNameArgument(element: unknown): string | undefined {
  const args: unknown = (element as { $args?: unknown }).$args;
  if (!Array.isArray(args)) {
    return undefined;
  }
  const name: unknown = asRecord(args[0]).name;
  return typeof name === "string" ? name : undefined;
}

function calleeName(element: unknown): string | undefined {
  if (typeof element !== "object" || element === null) {
    return undefined;
  }
  const record = element as { $type?: unknown; $callee?: unknown };
  return record.$type === "function-call" && typeof record.$callee === "string"
    ? record.$callee
    : undefined;
}

/**
 * The `name` literal of the `definePolicy({ ... })` call inside the factory `export`
 * called `callee` — `strictPolicy` → `"strict"`.
 *
 * A plain AST walk rather than an evaluation: the factory is a one-line return in every
 * file this ships, and running a project's own module to read a string would be a much
 * larger promise than `doctor` makes anywhere else. A factory that computes its name
 * reads as absent here and is simply not checked, which is the honest answer.
 */
function policyNameIn(source: string, callee: string): string | undefined {
  let program: unknown;
  try {
    program = parseModule(source).$ast;
  } catch {
    return undefined;
  }

  const factory = findNode(
    program,
    (node) =>
      (node.type === "FunctionDeclaration" ||
        node.type === "VariableDeclarator") &&
      asRecord(node.id).name === callee
  );
  if (!factory) {
    return undefined;
  }

  const call = findNode(
    factory,
    (node) =>
      node.type === "CallExpression" &&
      asRecord(node.callee).name === "definePolicy"
  );
  const argument = asArray(call?.arguments)[0];
  const property = asArray(asRecord(argument).properties).find(
    (entry) => asRecord(asRecord(entry).key).name === "name"
  );
  const value = asRecord(asRecord(property).value).value;
  return typeof value === "string" ? value : undefined;
}

/** First node in `root` (depth first) the predicate accepts. */
function findNode(
  root: unknown,
  accept: (node: Record<string, unknown> & { type: string }) => boolean
): (Record<string, unknown> & { type: string }) | undefined {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findNode(child, accept);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof root !== "object" || root === null) {
    return undefined;
  }
  const node = root as Record<string, unknown> & { type?: unknown };
  if (typeof node.type === "string") {
    const typed = node as Record<string, unknown> & { type: string };
    if (accept(typed)) {
      return typed;
    }
  }
  for (const [key, value] of Object.entries(node)) {
    // recast's own bookkeeping; walking it re-walks the whole file.
    if (key === "loc" || key === "comments" || key === "original") {
      continue;
    }
    const found = findNode(value, accept);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Read what `checkPolicyBindings` needs off a project on disk, or `undefined` when the
 * rule does not apply here.
 *
 * It applies only with `kv-cloudflare` installed. Every other provider keeps its budgets
 * in its own store or counts them itself, so `wrangler.jsonc` says nothing about them and
 * reporting a "missing" binding would be noise on a project that never wanted one.
 */
export async function readPolicyState(
  root: string,
  installed: string[]
): Promise<PolicyBindingArgs | undefined> {
  if (!installed.includes(CLOUDFLARE_KV_MODULE)) {
    return undefined;
  }
  const index = await readIfPresent(resolveWithinRoot(root, KV_INDEX_FILE));
  const wrangler = await readIfPresent(resolveWithinRoot(root, WRANGLER_FILE));
  if (index === undefined || wrangler === undefined) {
    return undefined;
  }

  const policySources: Record<string, string> = {};
  for (const specifier of relativeImportsIn(index)) {
    const source = await readIfPresent(
      resolveWithinRoot(
        root,
        posix.join(posix.dirname(KV_INDEX_FILE), `${specifier}.ts`)
      )
    );
    if (source !== undefined) {
      policySources[specifier] = source;
    }
  }
  return { index, policySources, wrangler };
}

/** Every relative specifier `index.ts` imports from — the candidates a policy can live in. */
function relativeImportsIn(index: string): string[] {
  let mod;
  try {
    mod = parseModule(index);
  } catch {
    return [];
  }
  const imports = mod.imports as unknown as ModuleImports;
  const specifiers = new Set<string>();
  for (const held of Object.values(imports)) {
    if (typeof held?.from === "string" && held.from.startsWith(".")) {
      specifiers.add(held.from);
    }
  }
  return [...specifiers];
}

export interface DoctorTarget {
  /** The registry directory the modules sit in. */
  registryDir: string;
  /** Module folder names to check — one, or every module the registry offers. */
  names: string[];
}

/**
 * Read `path` as either one module folder or a registry of them. A folder carrying a
 * `registry-item.json` is the module; anything else is a directory of module folders.
 */
export async function resolveDoctorTarget(path: string): Promise<DoctorTarget> {
  const dir = resolve(path);
  if (await pathExists(join(dir, "registry-item.json"))) {
    return { names: [basename(dir)], registryDir: dirname(dir) };
  }
  return { names: await registryModuleNames(dir), registryDir: dir };
}

export interface ProjectState {
  /** The project's `.saasaloy/manifest.json`, as `loadManifest` returns it. */
  manifest: Manifest;
  /** `saasaloy.json`'s `installed` list. */
  installed: string[];
}

/**
 * The inverse of `checkProject`'s rule (#49): a module the manifest tracks work for,
 * absent from `installed`, is a partial install.
 *
 * `add` leaves that state on purpose. It never rolls back, so a run that failed mid-apply
 * — or one whose file drifted between the plan and the write — keeps the files it wrote
 * and withholds the install. The bookkeeping is honest and the project is unfinished, and
 * only a re-run finishes it, which is what this says out loud. Two files, or twenty, are
 * one finding: the module is the unit the user acts on.
 */
export function checkPartialInstalls(state: ProjectState): Finding[] {
  const installed = new Set(state.installed);
  const tracked = new Set<string>();
  for (const entry of Object.values(state.manifest.managed)) {
    tracked.add(entry.module);
  }
  // A patch counts as tracked work too. A module whose files all held as conflicts can
  // still have landed a dependency in a package.json, and that is on disk either way.
  for (const patch of state.manifest.patches) {
    tracked.add(patch.module);
  }
  // The base records its files under a reserved name and is never in `installed` (#120).
  return [...tracked]
    .filter((name) => !installed.has(name) && name !== BASE_MODULE)
    .toSorted()
    .map((name) =>
      finding(
        name,
        `/installed/${name}`,
        `partial install — re-run \`saasaloy add ${name}\``
      )
    );
}

// ---------------------------------------------------------------------------
// The environment rules (#153).
// ---------------------------------------------------------------------------

/** The `.dev.vars` files this capability retired. A leftover one hides `.env` from wrangler. */
export const LEGACY_ENV_FILES = [".dev.vars", ".dev.vars.example"];

export interface EnvCheckArgs {
  /** Project-relative paths of every leftover `.dev.vars*` found on disk. */
  legacy: string[];
  /** True when the project carries `packages/env/.env.example`. */
  hasKeyList: boolean;
}

/**
 * The environment rule (#153): a leftover `.dev.vars` beside a service's `.env`.
 *
 * Wrangler loads `.env` only while no `.dev.vars` sits beside it, so every value
 * `pnpm env:setup` writes is ignored and nothing says so. That is the exact failure this
 * capability set out to end, and it is invisible from the outside — hence a check.
 * `pnpm env:setup` carries the file's values across and deletes it.
 *
 * Drift between the key list and the descriptors is not checked here. `doctor` runs
 * offline and the manifest does not record `envVars`, so answering that would turn it
 * into a network command; `saasaloy env --check`, which already reads every descriptor,
 * reports it instead.
 */
export function checkEnv(args: EnvCheckArgs): Finding[] {
  const findings = args.legacy
    .toSorted()
    .map((path) =>
      finding(
        "env",
        `/${path}`,
        `${path} still exists, and nothing reads it. wrangler loads .env only while no .dev.vars sits beside it, so every value pnpm env:setup writes is ignored. Run \`pnpm env:setup\` to carry its values into .env and delete it.`
      )
    );
  if (args.legacy.length > 0 && !args.hasKeyList) {
    findings.push(
      finding(
        "env",
        `/${ENV_EXAMPLE}`,
        `${ENV_EXAMPLE} is missing, so there is no key list to migrate those values into. Re-run \`saasaloy add\` for an installed module to regenerate it.`
      )
    );
  }
  return findings;
}

/** The runbook that moves a project off the deleted `infra` module. */
export const INFRA_RUNBOOK =
  "https://github.com/mimukit/saasaloy/blob/main/docs/wiki/runbooks/move-off-the-infra-module.md";

/**
 * The deploy rule (ADR 0043): a project that still carries the `infra/` workspace from
 * the Pulumi deploy that `pnpm deploy:production` replaced.
 *
 * It is a warning with a pointer, never a delete. `infra/state/` holds the ids of live
 * Cloudflare resources, and the runbook copies them out before anything goes.
 */
export function checkRetiredInfra(hasInfra: boolean): Finding[] {
  return hasInfra
    ? [
        finding(
          "deploy",
          "/infra",
          `infra/ is the Pulumi deploy that pnpm deploy:production replaced, and nothing runs it any more. Never run pulumi destroy: it deletes the live Workers and their data. Follow ${INFRA_RUNBOOK} to move the resource ids into wrangler.jsonc, then delete infra/.`
        ),
      ]
    : [];
}

/** Whether the project still has the `infra/` directory `checkRetiredInfra` reports. */
export function hasRetiredInfra(root: string): Promise<boolean> {
  return pathExists(resolveWithinRoot(root, "infra"));
}

// ---------------------------------------------------------------------------
// The gated deploy rules (ADR 0048).
// ---------------------------------------------------------------------------

/** The owned file whose `DEPLOY_TARGETS` rows order `pnpm deploy:production`. */
export const DEPLOY_TARGETS_FILE = "packages/tooling/src/targets.ts";

/** The production migration task name the base and `database-d1` retired. */
const RETIRED_MIGRATE_TASK = "db:migrate:prod";

/** The managed wrapper behind `pnpm release` (ADR 0049). */
export const RELEASE_WRAPPER = "packages/tooling/src/release.ts";

export interface DeployCheckArgs {
  /** The project's `turbo.json`, or `undefined` when it has none. */
  turbo: string | undefined;
  /**
   * Every service the deploy engine uploads: a directory under `apps/` whose
   * `package.json` has a `name` and a `deploy` script, beside a `wrangler.jsonc` or
   * `wrangler.json`. The same rule the engine applies, so the two never disagree.
   */
  deployable: string[];
  /** The text of `packages/tooling/src/targets.ts`, or `undefined` when it is missing. */
  targets: string | undefined;
  /** Whether `packages/tooling/src/release.ts` exists. */
  releaseWrapper?: boolean;
  /** Whether the root `package.json` has a `release` script. */
  releaseScript?: boolean;
}

/**
 * The deploy rules (ADR 0048). Both are warnings with the fix printed: the project still
 * builds and runs, and `pnpm deploy:production` stops on the same state with its own
 * message. Doctor says so earlier.
 *
 * - `turbo.json` still names `db:migrate:prod`. A project that has not merged the new
 *   `turbo.json` keeps a `deploy` task that waits on a task no module defines any more.
 * - A deployable workspace has no `DEPLOY_TARGETS` row, so the engine cannot place it in
 *   the order and refuses to deploy.
 * - `release.ts` arrived through `update` and the root `package.json` has no `release`
 *   script, because that file went to a merge plan (ADR 0049). The deploy then warns on
 *   every run that no release names it.
 */
export function checkDeploy(args: DeployCheckArgs): Finding[] {
  const findings: Finding[] = [];
  if (args.releaseWrapper === true && args.releaseScript !== true) {
    findings.push(
      finding(
        "deploy",
        "/package.json",
        `${RELEASE_WRAPPER} exists and the root package.json has no release script, so pnpm release does not run. Add "release": "node ${RELEASE_WRAPPER}" and "release:dry": "node ${RELEASE_WRAPPER} --dry-run" to its scripts.`
      )
    );
  }
  if (args.turbo?.includes(RETIRED_MIGRATE_TASK)) {
    findings.push(
      finding(
        "deploy",
        "/turbo.json",
        `turbo.json still names ${RETIRED_MIGRATE_TASK}. The production migration is now db:prod:migrate, and it runs only when you ask for it with pnpm deploy:production --migrate. Remove "^${RETIRED_MIGRATE_TASK}" from the deploy task's dependsOn and delete the ${RETIRED_MIGRATE_TASK} task.`
      )
    );
  }
  if (args.deployable.length === 0) {
    return findings;
  }
  const where = `/${DEPLOY_TARGETS_FILE}`;
  if (args.targets === undefined) {
    findings.push(
      finding(
        "deploy",
        where,
        `${DEPLOY_TARGETS_FILE} is missing, so pnpm deploy:production has no deploy order. Run \`saasaloy update\` to create it, then give each of ${args.deployable.map((service) => `apps/${service}`).join(", ")} a DEPLOY_TARGETS row.`
      )
    );
    return findings;
  }
  const services = targetServices(args.targets);
  if (typeof services === "string") {
    findings.push(finding("deploy", where, services));
    return findings;
  }
  for (const service of args.deployable.toSorted()) {
    if (!services.includes(service)) {
      findings.push(
        finding(
          "deploy",
          where,
          `apps/${service} deploys and has no DEPLOY_TARGETS row, so pnpm deploy:production stops before it builds anything. Add { service: "${service}", order: <number> } to ${DEPLOY_TARGETS_FILE}. A lower order deploys first.`
        )
      );
    }
  }
  return findings;
}

/** The `service` of every `DEPLOY_TARGETS` row, or a message saying why there is none. */
function targetServices(source: string): string[] | string {
  let program: Program;
  try {
    program = parseModule(source).$ast as unknown as Program;
  } catch {
    return `${DEPLOY_TARGETS_FILE} could not be parsed, so its DEPLOY_TARGETS rows are unknown. Fix the syntax error, then run \`saasaloy doctor\` again.`;
  }
  const array = findConstArray(program, "DEPLOY_TARGETS");
  if (!array) {
    return `${DEPLOY_TARGETS_FILE} has no DEPLOY_TARGETS array literal. Keep it as export const DEPLOY_TARGETS: DeployTarget[] = [...], so saasaloy add can append a module's row.`;
  }
  return array.elements
    .map((element) => entryValue(element, "service"))
    .filter((service): service is string => typeof service === "string");
}

/** Read what `checkDeploy` needs off a project on disk. */
export async function readDeployState(root: string): Promise<DeployCheckArgs> {
  const deployable: string[] = [];
  for (const name of (
    await readDirNames(resolveWithinRoot(root, "apps"))
  ).toSorted()) {
    const dir = posix.join("apps", name);
    const hasWrangler =
      (await pathExists(resolveWithinRoot(root, `${dir}/wrangler.jsonc`))) ||
      (await pathExists(resolveWithinRoot(root, `${dir}/wrangler.json`)));
    const manifest = await readIfPresent(
      resolveWithinRoot(root, `${dir}/package.json`)
    );
    if (!hasWrangler || manifest === undefined) {
      continue;
    }
    let pkg: Record<string, unknown>;
    try {
      pkg = asRecord(JSON.parse(manifest));
    } catch {
      continue;
    }
    if (
      typeof pkg.name === "string" &&
      typeof asRecord(pkg.scripts).deploy === "string"
    ) {
      deployable.push(name);
    }
  }
  let releaseScript = false;
  try {
    const rootManifest = await readIfPresent(
      resolveWithinRoot(root, ROOT_MANIFEST)
    );
    releaseScript =
      rootManifest !== undefined &&
      typeof asRecord(asRecord(JSON.parse(rootManifest)).scripts).release ===
        "string";
  } catch {
    releaseScript = false;
  }
  return {
    turbo: await readIfPresent(resolveWithinRoot(root, "turbo.json")),
    deployable,
    targets: await readIfPresent(resolveWithinRoot(root, DEPLOY_TARGETS_FILE)),
    releaseWrapper: await pathExists(resolveWithinRoot(root, RELEASE_WRAPPER)),
    releaseScript,
  };
}

/** Read what `checkEnv` needs off a project on disk. */
export async function readEnvState(root: string): Promise<EnvCheckArgs> {
  const legacy: string[] = [];
  for (const workspace of ["apps/api", "apps/web", "apps/admin"]) {
    for (const name of LEGACY_ENV_FILES) {
      const path = posix.join(workspace, name);
      if (await pathExists(resolveWithinRoot(root, path))) {
        legacy.push(path);
      }
    }
  }
  return {
    legacy,
    hasKeyList: await pathExists(resolveWithinRoot(root, ENV_EXAMPLE)),
  };
}

export interface RequirementState {
  /** `saasaloy.json`'s `installed` list. */
  installed: string[];
  /** The project's lock, the one offline record of each module's `requiresOneOf`. */
  lock: Lockfile;
}

/**
 * An installed module whose `requiresOneOf` names no installed module (#229). `add` and
 * `update` refuse to create that state, but `remove` of the one owner leaves it, and so
 * does a lock written by a hand edit. The project then imports files nobody ships. Read
 * from the lock because the descriptor is gone, so an entry written before the lock
 * recorded `requiresOneOf` is not checked until the next `add` or `update` rewrites it.
 */
export function checkUnmetRequirements(state: RequirementState): Finding[] {
  const installed = new Set(state.installed);
  return state.installed
    .filter((name) => {
      const options = state.lock.modules[name]?.requiresOneOf ?? [];
      return (
        options.length > 0 && !options.some((option) => installed.has(option))
      );
    })
    .toSorted()
    .map((name) => {
      const options = state.lock.modules[name]?.requiresOneOf ?? [];
      return finding(
        name,
        `/installed/${name}`,
        `needs one of: ${options.join(", ")}, and none is installed — run ${options
          .map((option) => `\`saasaloy add ${option}\``)
          .join(" or ")}`
      );
    });
}

/** Check every module named by `target`, in name order. */
export async function checkTarget(
  target: DoctorTarget
): Promise<ModuleReport[]> {
  const siblings = await registryModuleNames(target.registryDir);
  const aliases = await collectAliases(target.registryDir, siblings);
  const reports: ModuleReport[] = [];
  for (const name of target.names) {
    reports.push(
      await checkModule({
        aliases,
        dir: join(target.registryDir, name),
        siblings,
      })
    );
  }
  return reports;
}

export interface BaseCheckArgs {
  root: string;
  lock: Lockfile;
  manifest: Manifest;
  /** The seed paths the running template declares — listed, never hashed. */
  seedFiles: string[];
  /**
   * The root `package.json` `version` the running template ships. A file that matches
   * its record once its version is set to this one is not drifted, because a release
   * bumps the version (ADR 0049).
   */
  templateVersion?: string | undefined;
}

export interface BaseReport {
  /** `untracked` when the project carries no usable record; `update` writes one. */
  status: "tracked" | "untracked";
  record?: LockBase;
  /** Managed base files whose bytes no longer match their recorded hash. */
  drifted: string[];
  /** Managed base files the record names that are not on disk. */
  missing: string[];
  /** How many managed base files still match their recorded hash. */
  matching: number;
  /** Seed files — declared by the template, or recorded as such — reported but not checked. */
  seed: string[];
}

/**
 * The base half of `doctor <project>` (#120): is there a record, which CLI wrote it, and
 * which managed base files moved since. A drifted file is information, not a problem —
 * the owner is meant to edit the base — so this never contributes a `Finding`, and it
 * never writes: an untracked base is reported and left for `update` to adopt.
 */
export async function checkBase(args: BaseCheckArgs): Promise<BaseReport> {
  const { root, lock, manifest } = args;
  const seedSet = new Set(args.seedFiles);
  if (!isBaseTracked(lock, manifest) || !lock.base) {
    return {
      status: "untracked",
      drifted: [],
      missing: [],
      matching: 0,
      seed: args.seedFiles.toSorted(),
    };
  }
  const drifted: string[] = [];
  const missing: string[] = [];
  const seed: string[] = [];
  let matching = 0;
  for (const [target, entry] of Object.entries(baseEntries(manifest))) {
    if (seedSet.has(target)) {
      seed.push(target);
      continue;
    }
    const mine = await readIfPresent(resolveWithinRoot(root, target));
    if (mine === undefined) {
      missing.push(target);
    } else if (
      hashContent(mine) === entry.hash ||
      (target === ROOT_MANIFEST &&
        args.templateVersion !== undefined &&
        hashContent(withRootVersion(mine, args.templateVersion)) === entry.hash)
    ) {
      matching++;
    } else {
      drifted.push(target);
    }
  }
  return {
    status: "tracked",
    record: lock.base,
    drifted: drifted.toSorted(),
    missing: missing.toSorted(),
    matching,
    seed: seed.toSorted(),
  };
}

// ---------------------------------------------------------------------------
// The `config` rules (#154).
// ---------------------------------------------------------------------------

/** The one file a project owner edits in `@repo/config`. */
export const CONFIG_PROJECT_FILE = "packages/config/src/project.ts";
/** The values file `saasaloy env` writes and `pnpm env:setup` copies from. */
const ENV_VALUES_FILE = "packages/env/.env";
/**
 * The env var `config.app.name` superseded. Billing no longer declares it, so a fresh
 * project never lists it; an older project's key list keeps the line, because `add` never
 * removes one, and this is how its owner learns the value does nothing.
 */
const DEPRECATED_APP_NAME = "BILLING_APP_NAME";

export interface ConfigCheckArgs {
  /** Project-relative path → contents, for `packages/env/.env` and every service `.env`. */
  envFiles?: Record<string, string>;
}

/**
 * The one thing nothing else checks (#154): `BILLING_APP_NAME`, the env var `config`
 * replaced, still set in a `.env`, where it looks effective and is not.
 *
 * It reads the files rather than the composed object, because `doctor` never executes
 * project code.
 *
 * The product name is not checked. The base ships it as "Saasaloy" on purpose, so it
 * agrees with the shipped landing copy, and an unchanged name is not a defect. Neither is
 * the site origin: the canonical origin is `PUBLIC_SITE_URL`, an `env` value per
 * deployment, and `checkEnv` owns the env files.
 */
export function checkConfigValues(args: ConfigCheckArgs): Finding[] {
  const findings: Finding[] = [];

  // `pnpm env:setup` copies the values file into each service's `.env`, so a key set in
  // `packages/env/.env` would otherwise be reported once per copy. Report the source when
  // it sets the key; a service file is reported only when the source does not, which is
  // a value someone typed there by hand or a source other than the values file.
  const setting = Object.entries(args.envFiles ?? {})
    .filter(([, contents]) => assignsVar(contents, DEPRECATED_APP_NAME))
    .map(([file]) => file)
    .toSorted();
  const reported = setting.includes(ENV_VALUES_FILE)
    ? [ENV_VALUES_FILE]
    : setting;
  for (const file of reported) {
    findings.push(
      finding(
        "billing",
        `/env/${DEPRECATED_APP_NAME}`,
        `${file} sets ${DEPRECATED_APP_NAME}, which nothing reads any more — the billing emails take their name from config.app.name (or config.billing.appName). Delete the line, and set the name in ${CONFIG_PROJECT_FILE}.`
      )
    );
  }

  return findings;
}

/** Whether a dotenv-style file assigns `name` on an uncommented line with a value. */
function assignsVar(contents: string, name: string): boolean {
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const [key, ...rest] = trimmed.replace(/^export\s+/, "").split("=");
    if (key?.trim() === name && rest.join("=").trim() !== "") {
      return true;
    }
  }
  return false;
}

/**
 * Every `.env` a project carries, read off disk: the values file `saasaloy env` writes,
 * then each service's own copy that `pnpm env:setup` writes from it (ADR 0040). A leftover
 * `.dev.vars` is `checkEnv`'s finding, not this one's.
 */
async function readEnvFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const targets = [ENV_VALUES_FILE];
  for (const app of await readDirNames(join(root, "apps"))) {
    targets.push(posix.join("apps", app, ".env"));
  }
  for (const target of targets) {
    const contents = await readIfPresent(resolveWithinRoot(root, target));
    if (contents !== undefined) {
      out[target] = contents;
    }
  }
  return out;
}

/** Read what `checkConfigValues` needs off a project on disk. */
export async function readConfigState(root: string): Promise<ConfigCheckArgs> {
  return {
    envFiles: await readEnvFiles(root),
  };
}
