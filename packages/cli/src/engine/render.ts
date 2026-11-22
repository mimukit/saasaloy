import { posix } from "node:path";
import { BASE_MODULE } from "../lib/base.js";
import {
  baseSectionClaims,
  declaredSectionKey,
  detectCollisions,
  detectSectionCollisions,
  formatCollisions,
  formatOwnedCollisions,
  formatSectionCollisions,
  formatSectionKeyMismatches,
  sectionClaims,
  sectionFileOf,
} from "../lib/collisions.js";
import type { SectionClaim, SectionKeyMismatch } from "../lib/collisions.js";
import { detectConflicts, formatConflicts } from "../lib/conflicts.js";
import {
  ENV_EXAMPLE,
  parseEnvExample,
  renderEnvExample,
  servicesFor,
} from "../lib/env-example.js";
import type { ServiceName } from "../lib/env-example.js";
import { RefusalError } from "../lib/exit.js";
import { emptyLock } from "../lib/lock.js";
import { renderModule } from "../lib/module-render.js";
import { applyPatch } from "../lib/patch/index.js";
import { mergeDeps, planDeps } from "../lib/pkg-json.js";
import type { PackageJson } from "../lib/pkg-json.js";
import type { LoadedModule } from "../lib/registry.js";
import {
  detectMissingRequirements,
  formatMissingRequirements,
} from "../lib/requires.js";
import type { Requested } from "../lib/requested.js";
import type { Graph } from "../lib/resolve.js";
import {
  CONFIG_FILE,
  migrateBase,
  resolveTarget,
} from "../lib/saasaloy-config.js";
import type { LoadedConfig } from "../lib/saasaloy-config.js";
import {
  applyVars,
  renderedName,
  renderTemplateFile,
  templateVars,
} from "../lib/scaffold.js";
import type { TemplateVars } from "../lib/scaffold.js";
import type { RegistryEntry, RegistryPatch, When } from "../lib/schema.js";
import { DEFAULT_TESTING_MODE } from "../lib/testing.js";
import {
  BRAND_CSS,
  DEFAULT_THEME,
  rewriteBrandCss,
  rewriteDesign,
  THEMES,
  WEB_DESIGN,
} from "../lib/theme.js";
import type { ThemeName } from "../lib/theme.js";
import type { TestingMode } from "../lib/testing.js";
import { whenHolds } from "../lib/when.js";
import type { WhenContext } from "../lib/when.js";
import { classifier } from "./classes.js";
import type { FileClass } from "./classes.js";
import type { Payload, PayloadModule } from "./payload.js";
import { renderTables } from "./tables.js";

// The render (plan 0116, Phase 2): the whole project a set of modules makes, as a map
// from path to content and class. It reads no disk and no network; the caller loads the
// payload first. The result depends on the set alone, never on the order the names
// arrive in, because every step runs in one fixed order: dependency order, then module
// name.
//
// It produces what `init` and then one `add` of the set write today, minus the state
// files (`.saasaloy/manifest.json`, `saasaloy-lock.json`) that `apply` owns and the
// `.claude/skills/*` links, which are not files:
//
//   1. the base template, `_name` renamed and `{{VAR}}` filled, the testing block set;
//   2. each module's files at their targets, its `when` gates applied;
//   3. each descriptor patch as an in-memory transform, with the insert side of the
//      codemods in `lib/patch/`;
//   4. each registration table the set owns, as a generated file holding the rows the
//      set adds to it (`engine/tables.ts`);
//   5. the files `add` derives from the set: the root `package.json` dependencies, the
//      key list `packages/env/.env.example`, and `saasaloy.json`.

export interface RenderOptions {
  /** The project's name: `{{PROJECT_NAME}}` in every file and patch. */
  projectName: string;
  /**
   * The project's testing mode, as the owner chose it. A set holding an `enablesTesting`
   * module turns `off` into `tests-after`, as `add` does (#242).
   */
  testingMode?: TestingMode;
  /**
   * The project's theme (plan 0121). A theme other than `neutral` rewrites the base
   * brand.css and apps/web/DESIGN.md, and `saasaloy.json` records it. Absent reads as
   * `neutral`, the template's own tokens.
   */
  theme?: ThemeName;
  /** The `{{VAR}}` values. `templateVars(projectName)` when absent. */
  vars?: TemplateVars;
}

export interface RenderArgs {
  payload: Payload;
  /** The modules the owner asked for. Their `dependsOn` closure renders too. */
  requested: readonly string[];
  options: RenderOptions;
}

export interface RenderedFile {
  /** Project-relative POSIX path. */
  path: string;
  /** The raw render, before any Prettier: the bytes the manifest hash is taken of. */
  content: string;
  class: FileClass;
  /** The module whose file this is, or `base` for a template file. */
  module: string;
  /** Module-relative source path (`files/src/x.ts`), or template-relative for `base`. */
  from: string;
  /**
   * A descriptor patch changed the file in this render. The old engine ran the project's
   * Prettier over each patched file after the write, so `apply` formats both sides of
   * such a file before it compares them with the disk (plan 0116, "Formatting").
   */
  transformed?: true;
}

export interface RenderResult {
  /** Every rendered file, keyed by path, in path order. */
  files: Map<string, RenderedFile>;
  /** The resolved set in the fixed order: dependency order, then module name. */
  order: string[];
  /** The testing mode the render used, after an `enablesTesting` module. */
  testingMode: TestingMode;
  /** `saasaloy.json`'s alias map, the scaffold aliases included. */
  aliases: Record<string, string>;
  /** Folders under `.agents/skills/`, each one a `.claude/skills/<name>` link to make. */
  skills: string[];
  /** Every env var the set declares: name to description. */
  envVars: Record<string, string>;
  /** Each module's `removeWarnings`, for the modules that declare some. */
  removeWarnings: Record<string, string[]>;
  /** Patches with no target file, codemod refusals and dependency version conflicts. */
  warnings: string[];
}

/** The mode `add` of an `enablesTesting` module turns testing on to (#242, ADR 0054). */
const ENABLED_MODE: TestingMode = "tests-after";

/** The `dependsOn` closure of `requested` over the payload. Unknown names refuse. */
export function closure(
  payload: Pick<Payload, "modules" | "source" | "ref">,
  requested: readonly string[]
): Set<string> {
  const seen = new Set<string>();
  const stack = [...requested].map((name) => ({ name, requiredBy: "" }));
  while (stack.length > 0) {
    const { name, requiredBy } = stack.pop() ?? { name: "", requiredBy: "" };
    if (seen.has(name)) {
      continue;
    }
    const mod = payload.modules.get(name);
    if (!mod) {
      const because = requiredBy ? ` (required by ${requiredBy})` : "";
      throw new RefusalError(
        `Unknown module "${name}"${because} — the payload ${payload.source}@${payload.ref} holds no descriptor for it.`
      );
    }
    seen.add(name);
    for (const dep of mod.item.dependsOn ?? []) {
      stack.push({ name: dep, requiredBy: name });
    }
  }
  return seen;
}

/**
 * The fixed order: every module after the modules it depends on, and among the modules
 * whose prerequisites are all placed, the lowest name first. A cycle throws.
 */
export function fixedOrder(
  modules: ReadonlyMap<string, Pick<PayloadModule, "item">>,
  names: Iterable<string>
): string[] {
  const set = new Set(names);
  const waiting = new Map<string, Set<string>>();
  for (const name of set) {
    const deps = (modules.get(name)?.item.dependsOn ?? []).filter((dep) =>
      set.has(dep)
    );
    waiting.set(name, new Set(deps));
  }
  const order: string[] = [];
  while (waiting.size > 0) {
    const ready = [...waiting]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .toSorted();
    const next = ready[0];
    if (next === undefined) {
      throw new Error(
        `Dependency cycle detected among: ${[...waiting.keys()].toSorted().join(", ")}.`
      );
    }
    waiting.delete(next);
    for (const deps of waiting.values()) {
      deps.delete(next);
    }
    order.push(next);
  }
  return order;
}

/** A module file the render writes, before its content is read. */
interface SelectedFile {
  from: string;
  seed: boolean;
}

/**
 * The files one module ships in this set, keyed by target: `files[]`, each scaffold's
 * workspace files, then each `agent.skills` folder. An entry whose gate fails is
 * dropped; of two entries on one target the later one wins.
 */
export function selectFiles(
  mod: PayloadModule,
  aliases: Record<string, string>,
  ctx: WhenContext
): Map<string, SelectedFile> {
  const out = new Map<string, SelectedFile>();
  const record = (
    from: string,
    when: When | undefined,
    seed: boolean | undefined,
    target: () => string
  ): void => {
    if (!whenHolds(when, ctx)) {
      return;
    }
    out.set(target(), { from, seed: seed === true });
  };
  for (const file of mod.item.files ?? []) {
    record(file.path, file.when, file.seed, () =>
      resolveTarget(aliases, file.target)
    );
  }
  for (const scaffold of mod.item.scaffolds ?? []) {
    for (const file of scaffold.files) {
      record(file.path, file.when, file.seed, () =>
        posix.join(scaffold.workspace, file.target)
      );
    }
  }
  for (const skillRel of mod.item.agent?.skills ?? []) {
    const folder = posix.basename(skillRel);
    const prefix = `${posix.normalize(skillRel)}/`;
    for (const from of mod.files.keys()) {
      if (from.startsWith(prefix)) {
        out.set(
          posix.join(".agents/skills", folder, from.slice(prefix.length)),
          { from, seed: false }
        );
      }
    }
  }
  return out;
}

function moduleContent(mod: PayloadModule, from: string): string {
  const raw = mod.files.get(posix.normalize(from));
  if (raw === undefined) {
    throw new Error(
      `Module "${mod.name}" declares ${from}, and the payload holds no such file.`
    );
  }
  return raw;
}

/** The template's target for a source path: `_name` becomes `.name` in every segment. */
function templateTarget(from: string): string {
  return from.split("/").map(renderedName).join("/");
}

/**
 * The bytes the render copies for one source file, before any patch runs over it: a
 * template file with its `{{VAR}}` tokens and testing block filled, or a module file with
 * its tokens filled. This is what the old engine hashed into a version 1 manifest, so the
 * conversion (plan 0116, Phase 5) compares a recorded hash with it. `undefined` when the
 * payload holds no such source.
 */
export function copiedContent(
  payload: Pick<Payload, "base" | "modules">,
  file: { module: string; from: string; path: string },
  vars: TemplateVars,
  testingMode: TestingMode
): string | undefined {
  if (file.module === BASE_MODULE) {
    const raw = payload.base.files.get(file.from);
    return raw === undefined
      ? undefined
      : renderTemplateFile(file.path, raw, vars, { testingMode });
  }
  const raw = payload.modules
    .get(file.module)
    ?.files.get(posix.normalize(file.from));
  return raw === undefined ? undefined : applyVars(raw, vars);
}

/** Render a project from a payload. Pure: no disk, no network, no clock. */
export function render(args: RenderArgs): RenderResult {
  const { payload, requested, options } = args;
  const vars = options.vars ?? templateVars(options.projectName);
  const order = fixedOrder(payload.modules, closure(payload, requested));
  // How a refusal names the run: every requested module, as `add` names its names.
  const asked: Requested = { names: [...requested], rootOf: new Map() };
  const label = requested.length > 0 ? requested.join(", ") : undefined;
  const items = (name: string): PayloadModule => {
    const mod = payload.modules.get(name);
    if (!mod) {
      throw new Error(`Module "${name}" left the payload mid-render.`);
    }
    return mod;
  };

  // The descriptors as `lib/` helpers take them. `renderModule` fills `{{VAR}}` in the
  // patch entries, the way `add` renders a module as it enters a plan (#197).
  const loaded = new Map<string, LoadedModule>(
    order.map((name) => [
      name,
      renderModule({ dir: "", item: items(name).item }, vars),
    ])
  );
  const graph: Graph = { modules: loaded, order };

  const chosenMode = options.testingMode ?? DEFAULT_TESTING_MODE;
  const enabler = order.find(
    (name) => items(name).item.enablesTesting === true
  );
  const testingMode =
    chosenMode === "off" && enabler !== undefined ? ENABLED_MODE : chosenMode;

  // --- The base template ---------------------------------------------------------
  const declaration = payload.base.declaration;
  const classOf = classifier(declaration);
  const files = new Map<string, RenderedFile>();
  const put = (file: Omit<RenderedFile, "class">, seed?: boolean): void => {
    files.set(file.path, {
      ...file,
      class: classOf({
        module: file.module,
        path: file.path,
        ...(seed === undefined ? {} : { entry: { seed } }),
      }),
    });
  };
  for (const [from, raw] of payload.base.files) {
    const path = templateTarget(from);
    put({
      content: renderTemplateFile(path, raw, vars, { testingMode }),
      from,
      module: BASE_MODULE,
      path,
    });
  }

  // The theme rewrites two `once` base files: the tokens, then the contract that
  // records them and fingerprints the tokens file (ADR 0027).
  const theme = options.theme ?? DEFAULT_THEME;
  if (theme !== DEFAULT_THEME) {
    const brand = files.get(BRAND_CSS);
    if (brand) {
      const content = rewriteBrandCss(brand.content, THEMES[theme]);
      files.set(BRAND_CSS, { ...brand, content });
      const design = files.get(WEB_DESIGN);
      if (design) {
        files.set(WEB_DESIGN, {
          ...design,
          content: rewriteDesign(design.content, THEMES[theme], content),
        });
      }
    }
  }

  const configFile = files.get(CONFIG_FILE);
  if (!configFile) {
    throw new Error(`The payload's base template ships no ${CONFIG_FILE}.`);
  }
  // `init` writes the name and the mode into the template's own file, keys appended.
  const config: LoadedConfig = {
    ...migrateBase(JSON.parse(configFile.content) as LoadedConfig),
    name: options.projectName,
    testing: { mode: testingMode },
    ...(theme === DEFAULT_THEME ? {} : { theme }),
  };

  // --- The set: refusals `add` makes before it writes ------------------------------
  const unmet = detectMissingRequirements({
    config: { ...config, installed: [] },
    graph,
  });
  if (unmet.length > 0) {
    throw new RefusalError(formatMissingRequirements(unmet, asked));
  }
  const conflicts = detectConflicts({
    config: { ...config, installed: [] },
    graph,
    lock: emptyLock(),
  });
  if (conflicts.conflicts.length > 0) {
    throw new RefusalError(formatConflicts(conflicts.conflicts, asked));
  }

  // --- Aliases --------------------------------------------------------------------
  const scaffoldAliases: Record<string, string> = {};
  for (const name of order) {
    for (const scaffold of items(name).item.scaffolds ?? []) {
      for (const [alias, prefix] of Object.entries(scaffold.aliases ?? {})) {
        scaffoldAliases[alias] = prefix;
      }
    }
  }
  const aliases = { ...config.aliases };
  for (const [alias, prefix] of Object.entries(scaffoldAliases)) {
    aliases[alias] = prefix;
  }

  // --- Module files ---------------------------------------------------------------
  const ctx: WhenContext = { installed: new Set(order), testingMode };
  const selected = new Map<string, Map<string, SelectedFile>>();
  for (const name of order) {
    selected.set(name, selectFiles(items(name), aliases, ctx));
  }
  const collisions = detectCollisions({
    modules: loaded,
    planned: order.map((module) => ({
      module,
      targets: [...(selected.get(module)?.keys() ?? [])],
    })),
  });
  if (collisions.length > 0) {
    throw new RefusalError(formatCollisions(collisions, label));
  }
  const baseClaims = order.flatMap((claimant) =>
    [...(selected.get(claimant)?.keys() ?? [])]
      .filter((target) => files.get(target)?.module === BASE_MODULE)
      .map((target) => ({ claimant, owner: BASE_MODULE, target }))
  );
  if (baseClaims.length > 0) {
    throw new RefusalError(formatOwnedCollisions(baseClaims, label));
  }

  // Each patch a module ships in this set, `{{VAR}}` filled.
  const shipped = (name: string): RegistryPatch[] =>
    (loaded.get(name)?.item.patches ?? []).filter((op) =>
      whenHolds(op.when, ctx)
    );

  // Each table row a module ships in this set, `{{VAR}}` filled.
  const rowsOf = (name: string): RegistryEntry[] =>
    (loaded.get(name)?.item.entries ?? []).filter((entry) =>
      whenHolds(entry.when, ctx)
    );

  const keyClaims: SectionClaim[] = baseSectionClaims();
  for (const name of order) {
    keyClaims.push(...sectionClaims(name, rowsOf(name)));
  }
  const sectionConflicts = detectSectionCollisions(keyClaims);
  if (sectionConflicts.length > 0) {
    throw new RefusalError(formatSectionCollisions(sectionConflicts, label));
  }
  const mismatches: SectionKeyMismatch[] = [];
  for (const name of order) {
    const mod = items(name);
    for (const { key } of sectionClaims(name, rowsOf(name))) {
      const file = sectionFileOf(mod.item.files, key);
      const declared =
        file === undefined
          ? undefined
          : declaredSectionKey(moduleContent(mod, file.path));
      if (declared !== undefined && declared !== key) {
        mismatches.push({ claimed: key, declared, module: name });
      }
    }
  }
  if (mismatches.length > 0) {
    throw new RefusalError(formatSectionKeyMismatches(mismatches, label));
  }

  // The most specific writer wins a shared target: a driver after its capability.
  for (const name of order) {
    const mod = items(name);
    for (const [path, file] of selected.get(name) ?? []) {
      files.delete(path);
      put(
        {
          content: applyVars(moduleContent(mod, file.from), vars),
          from: file.from,
          module: name,
          path,
        },
        file.seed
      );
    }
  }

  // --- Patches, as transforms -----------------------------------------------------
  const warnings: string[] = [];
  for (const name of order) {
    for (const op of shipped(name)) {
      const target = files.get(op.file);
      if (!target) {
        warnings.push(
          `${name}: ${op.kind} on ${op.file} not applied — the render holds no such file.`
        );
        continue;
      }
      const result = applyPatch(target.content, op, op.file);
      if (result.changed) {
        files.set(op.file, {
          ...target,
          content: result.content,
          transformed: true,
        });
      } else if (result.reason !== undefined) {
        warnings.push(
          `${name}: ${op.kind} on ${op.file} not applied — ${result.reason}.`
        );
      }
    }
  }

  // --- Generated tables -------------------------------------------------------------
  const tables = renderTables({
    owners: [
      { module: BASE_MODULE, tables: declaration.tables ?? [] },
      ...order.map((name) => ({
        module: name,
        tables: loaded.get(name)?.item.tables ?? [],
      })),
    ],
    resolve: (file) =>
      file.startsWith("@") ? resolveTarget(aliases, file) : file,
    rows: order.map((name) => ({ entries: rowsOf(name), module: name })),
  });
  warnings.push(...tables.warnings);
  for (const table of tables.files) {
    const held = files.get(table.path);
    if (held !== undefined) {
      throw new RefusalError(
        `${table.path} is a generated table of ${table.owner === BASE_MODULE ? "the base template" : `module "${table.owner}"`}, and ${held.module === BASE_MODULE ? "the base template" : `module "${held.module}"`} ships a file at that path.`
      );
    }
    files.set(table.path, {
      class: "generated",
      content: table.content,
      from: table.path,
      module: table.owner,
      path: table.path,
    });
  }

  // --- Files `add` derives from the set ---------------------------------------------
  const derived = deriveFromSet(order, items);

  const rootPackage = files.get("package.json");
  if (
    rootPackage &&
    derived.dependencies.length + derived.devDependencies.length > 0
  ) {
    const pkg = JSON.parse(rootPackage.content) as PackageJson;
    const plan = planDeps(pkg, derived.dependencies, derived.devDependencies);
    for (const conflict of plan.conflicts) {
      warnings.push(`Dependency version conflict — ${conflict}.`);
    }
    if (plan.added.length + plan.devAdded.length > 0) {
      files.set("package.json", {
        ...rootPackage,
        content: mergeDeps(pkg, plan.added, plan.devAdded),
      });
    }
  }

  // `add` regenerates the key list on every run, and `init` alone copies the template's.
  if (order.length > 0) {
    const current = files.get(ENV_EXAMPLE);
    const existing = parseEnvExample(current?.content ?? "");
    if (
      Object.keys(derived.envVars).length > 0 ||
      Object.keys(existing).length > 0
    ) {
      const content = renderEnvExample({
        devVars: derived.devVars,
        envVars: derived.envVars,
        existing,
        optional: derived.envOptional,
        services: derived.envServices,
      });
      put({
        content,
        from: current?.from ?? ENV_EXAMPLE,
        module: current?.module ?? BASE_MODULE,
        path: ENV_EXAMPLE,
      });
    }
  }

  const finalConfig: LoadedConfig = {
    ...config,
    aliases,
    installed: [...order],
  };
  files.set(CONFIG_FILE, {
    ...configFile,
    content: `${JSON.stringify(finalConfig, null, 2)}\n`,
  });

  const removeWarnings: Record<string, string[]> = {};
  for (const name of order) {
    const list = items(name).item.removeWarnings ?? [];
    if (list.length > 0) {
      removeWarnings[name] = [...list];
    }
  }

  const sorted = new Map(
    [...files.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  const skills = [
    ...new Set(
      [...sorted.keys()]
        .filter((path) => path.startsWith(".agents/skills/"))
        .map((path) => path.split("/")[2] ?? "")
        .filter((name) => name !== "")
    ),
  ];

  return {
    aliases,
    envVars: derived.envVars,
    files: sorted,
    order,
    removeWarnings,
    skills,
    testingMode,
    warnings,
  };
}

/** What `add`'s plan unions across the set: npm dependencies and the env key list. */
interface Derived {
  dependencies: string[];
  devDependencies: string[];
  envVars: Record<string, string>;
  devVars: Record<string, string>;
  envServices: Record<string, ServiceName[]>;
  envOptional: string[];
}

function deriveFromSet(
  order: readonly string[],
  items: (name: string) => PayloadModule
): Derived {
  const dependencies: string[] = [];
  const devDependencies: string[] = [];
  const envVars: Record<string, string> = {};
  const devVars: Record<string, string> = {};
  const envServices: Record<string, ServiceName[]> = {};
  const declaredBy = new Map<string, Set<string>>();
  const optionalBy = new Map<string, Set<string>>();
  for (const name of order) {
    const { item } = items(name);
    dependencies.push(...(item.dependencies ?? []));
    devDependencies.push(...(item.devDependencies ?? []));
    for (const [key, value] of Object.entries(item.devVars ?? {})) {
      devVars[key] = value;
    }
    for (const key of item.envOptional ?? []) {
      optionalBy.set(key, (optionalBy.get(key) ?? new Set()).add(name));
    }
    for (const [key, value] of Object.entries(item.envVars ?? {})) {
      envVars[key] = value;
      declaredBy.set(key, (declaredBy.get(key) ?? new Set()).add(name));
      envServices[key] = [
        ...new Set([
          ...(envServices[key] ?? []),
          ...servicesFor(key, item.envServices),
        ]),
      ];
    }
  }
  // A key may stay blank only when every module declaring it says so (#249).
  const envOptional = [...declaredBy]
    .filter(([key, modules]) =>
      [...modules].every((module) => optionalBy.get(key)?.has(module))
    )
    .map(([key]) => key)
    .toSorted();
  return {
    dependencies,
    devDependencies,
    devVars,
    envOptional,
    envServices,
    envVars,
  };
}
