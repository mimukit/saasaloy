// Maintainer dependency-update workflow for the files pnpm's own tooling can't see:
// the base-template package.jsons and the module descriptors. These ship dependency
// versions to downstream projects but aren't pnpm workspace members, so `pnpm outdated`
// / `pnpm update` never touch them — and because we pin EXACT versions, pnpm's
// install-time `minimumReleaseAge` cooldown has nothing to resolve and never applies
// either. This script is therefore the ONLY place a supply-chain cooldown can gate
// these files, enforced here at version-SELECTION time (ADR 0016).
//
//   pnpm deps:update  → grouped report → interactive select + confirm → rewrite to
//                       the resolved exact versions. This is the human workflow: in a
//                       TTY it always shows the picker (eligible within-major bumps
//                       pre-checked; majors listed in their own group, unchecked) and
//                       asks to confirm before writing. `--yes` (or a non-TTY) skips
//                       the prompts and applies every eligible bump.
//   pnpm deps:check   → read-only drift report that exits non-zero on actionable drift
//                       (this script with --check) — the CI gate, not the daily command.
//   --dry-run         → print the report and the "would update" preview, then stop. Never
//                       opens the picker and never writes — a pure preview of a default apply.
//
// Node 24: node:fs + global fetch for the resolver. The terminal UI reuses the CLI's
// own stack — @clack/prompts + picocolors (root devDependencies) — for a grouped,
// semver-colored report, an interactive group-picker, and a confirm step. Maintainer-
// only; never shipped to consumers, so the dep cost stays off the published surface
// (ADR 0016 / plan Phase 7).
//
// Resolver policy (ADR 0016): per package, enumerate the npm `versions` map, DROP
// prereleases, IGNORE dist-tags (never trust `latest`), cap at the highest eligible
// version WITHIN the current major, and require the publish time to clear
// `minimumReleaseAge` (read from pnpm-workspace.yaml). A newer major is surfaced as
// `major-available` and crossed only with --allow-major; the cooldown is overridden
// only with --allow-fresh. Each manifest resolves independently from npm.
//
// TypeScript, run directly by Node 24's type stripping — there is no build step. The
// types are checked by `pnpm typecheck` through tsconfig.scripts.json (#54).

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  intro,
  outro,
  note,
  log,
  spinner,
  groupMultiselect,
  confirm,
  isCancel,
  cancel,
} from "@clack/prompts";
import type { Option } from "@clack/prompts";
import pc from "picocolors";

const root = resolve(import.meta.dirname, "..");

// --- Types -------------------------------------------------------------------
// Everything read from outside this script — npm packuments, package.jsons, module
// descriptors — arrives as `unknown` and is narrowed at the point of use. The shapes
// below describe only the thin slice actually consumed; every unrecognized key rides
// through untouched on write-back.

/** The one guard every external-JSON site funnels through. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The slice of an npm packument the resolver uses, normalized at the fetch boundary. */
interface Packument {
  /** version → ISO publish time. Empty when the registry omits it. */
  time: Record<string, string>;
  /** The published `versions` map; only its keys are read. */
  versions: Record<string, unknown>;
}

type DepBucket = "dependencies" | "devDependencies";
const DEP_BUCKETS: readonly DepBucket[] = ["dependencies", "devDependencies"];

/** How a version spec is written, which drives its status and what a write produces. */
type SpecKind = "bare" | "exact" | "range";

/** One scannable dependency lifted out of a manifest. */
interface Dep {
  bucket: DepBucket;
  name: string;
  spec: string;
  kind: SpecKind;
}

type ManifestKind = "package-json" | "registry-item";

/** A discovered manifest, before it has been read. */
interface ManifestFile {
  file: string;
  kind: ManifestKind;
}

/**
 * A manifest that has been read: its parsed document — kept because the write pass
 * rewrites it in place to preserve key order — plus its scannable deps.
 */
interface Manifest extends ManifestFile {
  json: Record<string, unknown>;
  deps: Dep[];
}

/** What deps:update could pin for one dep, plus the context the report needs. */
interface Resolved {
  target: string | null;
  targetOverall: string | null;
  highestWithinMajor: string | null;
  highestOverall: string | null;
  newerMajor: boolean;
}

type Status =
  | "up-to-date"
  | "outdated"
  | "range→exact"
  | "bare→pinned"
  | "major-available"
  | "within-cooldown"
  | "unresolved";

/** One resolved (manifest, dep) pair — the unit the report and the picker render. */
interface Row {
  manifest: Manifest;
  dep: Dep;
  resolved: Resolved | null;
  status: Status;
  error?: string;
}

/** A (manifest, dep) pair awaiting registry resolution. */
interface Job {
  manifest: Manifest;
  dep: Dep;
}

/** One proposed write. */
interface Candidate {
  row: Row;
  target: string;
  kind: "primary" | "major";
  group: string;
}

/** A stable version as a numeric triple. */
type Semver = [number, number, number];

type SemverLevel = "major" | "minor" | "patch" | "none";

/** Which report section a row renders under. */
type GroupKey =
  | "major"
  | "minor"
  | "patch"
  | "migration"
  | "major-available"
  | "cooldown"
  | "unresolved"
  | "up-to-date";

/** A picocolors formatter, as this script uses them. */
type Colorize = (text: string) => string;

// --- CLI flags ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {
  allowFresh: argv.includes("--allow-fresh"),
  allowMajor: argv.includes("--allow-major"),
  check: argv.includes("--check"),
  dryRun: argv.includes("--dry-run"),
  yes: argv.includes("--yes") || argv.includes("-y"),
};
const KNOWN = new Set([
  "--check",
  "--allow-major",
  "--allow-fresh",
  "--dry-run",
  "--yes",
  "-y",
]);
const unknown = argv.filter((a) => a.startsWith("-") && !KNOWN.has(a));
if (unknown.length > 0) {
  console.error(`Unknown flag(s): ${unknown.join(", ")}`);
  console.error(
    "usage: update-deps.ts [--check] [--allow-major] [--allow-fresh] [--dry-run] [--yes|-y]"
  );
  process.exit(2);
}

// --- Skip rules: specs that aren't resolvable npm registry versions ----------
// A dep is skipped when its NAME is an internal workspace package or its VERSION
// spec is a non-registry protocol — pnpm owns those, not this tool.
function isSkippedName(name: string): boolean {
  return name.startsWith("@repo/");
}
function isSkippedSpec(spec: string): boolean {
  return (
    spec.startsWith("workspace:") ||
    spec.startsWith("catalog:") ||
    spec.startsWith("link:") ||
    spec.startsWith("file:") ||
    spec.includes("{{") // template token like {{PROJECT_NAME}}
  );
}

// --- Version-spec classification ---------------------------------------------
// A spec's "kind" drives its status and what deps:update writes:
//   exact  — "5.14.1"        → already pinned; bump only if a newer eligible exists
//   range  — "^5", "~4.1"    → migrate to exact (range→exact)
//   bare   — "" (no version) → pin it (bare→pinned); only descriptor arrays can be bare
const EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function classifySpec(spec: string): SpecKind {
  if (spec === "" || spec === "latest" || spec === "*") {
    return "bare";
  }
  if (EXACT_RE.test(spec)) {
    return "exact";
  }
  return "range";
}

// Leading major number of a spec, or null when there's nothing to anchor to (bare).
function specMajor(spec: string): number | null {
  const m = spec.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// --- Semver (stable-only) compare --------------------------------------------
// We only ever compare stable versions (prereleases are dropped before this), so a
// plain numeric triple compare is sufficient — no prerelease-precedence rules needed.
// The parse returns null for anything that is not a bare triple and every caller
// handles that null: the resolver only compares versions it already parsed, but a
// manifest's CURRENT spec can be a prerelease pin (EXACT_RE admits `1.2.3-beta`), and
// letting an unparsed capture flow into a comparison is how a bump decision goes
// silently wrong.
function parseSemver(v: string): Semver | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// A version that is not a stable triple sorts BELOW every version that is, so a real
// release always reads as newer than an unparseable pin rather than comparing as equal.
function cmp(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) {
    return (pa === null ? 0 : 1) - (pb === null ? 0 : 1);
  }
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

// An exact spec that EXACT_RE admits but parseSemver rejects: a prerelease or
// build-metadata pin such as `1.3.0-rc.1`. It has no orderable stable triple, so NO
// comparison against it can decide a bump — `cmp` sorts it BELOW every real release, so a
// LOWER stable version would read as "outdated" and a default apply would write a
// downgrade. Such a pin is reported and never written, which is the outcome the pre-#54
// script reached by throwing on the unparsed capture.
function isUnorderableExact(dep: Dep): boolean {
  return dep.kind === "exact" && parseSemver(dep.spec) === null;
}

// --- pnpm-workspace.yaml: minimumReleaseAge (single source of truth) ---------
async function readMinReleaseMinutes(): Promise<number> {
  const text = await readFile(join(root, "pnpm-workspace.yaml"), "utf-8");
  // Match the active (non-commented) `minimumReleaseAge: <n>` line.
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*minimumReleaseAge:\s*(\d+)\s*$/);
    if (m) {
      return Number(m[1]);
    }
  }
  return 0; // no cooldown configured → nothing is quarantined
}

// --- npm registry resolution -------------------------------------------------
// Cache the in-flight PROMISE (not just the resolved value): with parallel resolution the
// same package can be requested by several manifests at once, and caching the promise means
// they share a single fetch instead of racing duplicates.
const registryCache = new Map<string, Promise<Packument>>();

// Narrow the packument once, at the boundary: a missing or malformed `time` / `versions`
// becomes an empty map, which is exactly what the resolver's `?? {}` produced before.
function toPackument(doc: unknown): Packument {
  if (!isRecord(doc)) {
    return { time: {}, versions: {} };
  }
  const time: Record<string, string> = {};
  if (isRecord(doc.time)) {
    for (const [version, published] of Object.entries(doc.time)) {
      if (typeof published === "string") {
        time[version] = published;
      }
    }
  }
  return { time, versions: isRecord(doc.versions) ? doc.versions : {} };
}

function fetchPackument(name: string): Promise<Packument> {
  const cached = registryCache.get(name);
  if (cached) {
    return cached;
  }
  const p = (async (): Promise<Packument> => {
    const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`registry ${res.status} for ${name}`);
    }
    return toPackument(await res.json());
  })();
  registryCache.set(name, p);
  return p;
}

// Run an async fn over items with bounded concurrency, preserving input order in the
// results array. Resolves the whole dependency set far faster than a serial loop while
// keeping npm from seeing a burst of hundreds of simultaneous requests.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      // `i < items.length` on a densely built array, so the element is always present.
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// Resolve the versions deps:update could pin for one dep, plus the context the report
// needs. `target` is the within-major pin (the safe default, independent of any flag);
// `targetOverall` is the highest cooldown-eligible version across ALL majors — what a
// deliberate major bump would write. Returns
// { target, targetOverall, highestWithinMajor, highestOverall, newerMajor }.
async function resolveVersion(
  name: string,
  curMajor: number | null,
  minMinutes: number
): Promise<Resolved> {
  const doc = await fetchPackument(name);
  const times = doc.time;
  const now = Date.now();
  const cooldownMs = minMinutes * 60 * 1000;

  const stable = Object.keys(doc.versions).filter(
    (v) => parseSemver(v) !== null
  );
  stable.sort(cmp);

  const clearsCooldown = (v: string): boolean => {
    if (flags.allowFresh) {
      return true;
    }
    const t = times[v];
    return t ? now - Date.parse(t) >= cooldownMs : false;
  };

  // The within-major cap is a property of the dep, not a flag: majors are opted into
  // per-dep in the picker (or with --allow-major for non-interactive runs), never by
  // silently lifting the cap here. Bare specs have no anchor, so nothing to cap against.
  const withinMajor = (v: string): boolean => {
    if (curMajor === null) {
      return true;
    }
    const parsed = parseSemver(v);
    return parsed !== null && parsed[0] === curMajor;
  };

  // Every `[length - 1]` below is guarded by the `.length` check in front of it.
  const capped = stable.filter(withinMajor);
  const highestWithinMajor = capped.length ? capped.at(-1)! : null;
  const highestOverall = stable.length ? stable.at(-1)! : null;
  const eligibleWithin = capped.filter(clearsCooldown);
  const target = eligibleWithin.length ? eligibleWithin.at(-1)! : null;
  const eligibleAll = stable.filter(clearsCooldown);
  const targetOverall = eligibleAll.length ? eligibleAll.at(-1)! : null;
  const highestOverallSemver =
    highestOverall === null ? null : parseSemver(highestOverall);
  const newerMajor =
    curMajor !== null &&
    highestOverallSemver !== null &&
    highestOverallSemver[0] > curMajor;

  return {
    highestOverall,
    highestWithinMajor,
    newerMajor,
    target,
    targetOverall,
  };
}

// --- Manifest discovery ------------------------------------------------------
// Three "invisible" manifest classes, structured as globs so the third (scaffolded
// module workspaces) is already wired even though no create-module scaffold ships a
// package.json yet.
async function walk(
  dir: string,
  match: (file: string) => boolean,
  out: string[]
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // directory doesn't exist (e.g. empty modules/) — nothing to scan
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      await walk(abs, match, out);
    } else if (match(abs)) {
      out.push(abs);
    }
  }
  return out;
}

async function discoverManifests(): Promise<ManifestFile[]> {
  const manifests: ManifestFile[] = [];

  // Class 1: base template package.jsons (object-form deps/devDeps).
  for (const file of await walk(
    join(root, "packages/cli/templates/base"),
    (f) => f.endsWith("package.json"),
    []
  )) {
    manifests.push({ file, kind: "package-json" });
  }

  // Class 2: module descriptors (array-form dependencies[]/devDependencies[]).
  for (const file of await walk(
    join(root, "modules"),
    (f) => f.endsWith("registry-item.json"),
    []
  )) {
    manifests.push({ file, kind: "registry-item" });
  }

  // Class 3: scaffolded module workspace package.jsons (object-form). No-op until a
  // create-module scaffold ships one, but the glob is wired now.
  for (const file of await walk(
    join(root, "modules"),
    (f) => f.endsWith("package.json") && f.includes(join("", "files", "")),
    []
  )) {
    manifests.push({ file, kind: "package-json" });
  }

  return manifests;
}

// Read a manifest into the record the rest of the run carries: the discovered
// { file, kind }, the parsed document, and the scannable deps as a flat list of
// { bucket, name, spec, kind }. `bucket` is "dependencies" | "devDependencies".
async function readManifestDeps(manifest: ManifestFile): Promise<Manifest> {
  const raw = await readFile(manifest.file, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const json = isRecord(parsed) ? parsed : {};
  const deps: Dep[] = [];

  // A missing bucket is normal — a manifest need not declare both. A bucket that IS
  // present but has the wrong shape is a malformed manifest, and skipping it would silently
  // drop every dep it holds out of the cooldown gate, so it fails the run loudly (exit 2).
  const pushObject = (bucket: DepBucket) => {
    const map = json[bucket];
    if (map === undefined || map === null) {
      return;
    }
    if (!isRecord(map)) {
      throw new Error(
        `${manifest.file}: "${bucket}" must be an object of name → version`
      );
    }
    for (const [name, value] of Object.entries(map)) {
      const spec = String(value);
      if (isSkippedName(name) || isSkippedSpec(spec)) {
        continue;
      }
      deps.push({ bucket, kind: classifySpec(spec), name, spec });
    }
  };
  const pushArray = (bucket: DepBucket) => {
    const arr = json[bucket];
    if (arr === undefined || arr === null) {
      return;
    }
    if (!Array.isArray(arr)) {
      throw new TypeError(
        `${manifest.file}: "${bucket}" must be an array of "name@version" entries`
      );
    }
    for (const value of arr) {
      const entry = String(value);
      const at = entry.lastIndexOf("@");
      const name = at > 0 ? entry.slice(0, at) : entry;
      const spec = at > 0 ? entry.slice(at + 1) : "";
      if (isSkippedName(name) || isSkippedSpec(spec)) {
        continue;
      }
      deps.push({ bucket, kind: classifySpec(spec), name, spec });
    }
  };

  if (manifest.kind === "package-json") {
    pushObject("dependencies");
    pushObject("devDependencies");
  } else {
    pushArray("dependencies");
    pushArray("devDependencies");
  }
  return { deps, file: manifest.file, json, kind: manifest.kind };
}

// --- Status decision ---------------------------------------------------------
// Reduce a resolved dep to one status. Actionable statuses (what a default
// deps:update would change) drive the non-zero exit code; the rest are informational.
const ACTIONABLE = new Set<Status>(["outdated", "range→exact", "bare→pinned"]);

function decideStatus(dep: Dep, r: Resolved): Status {
  if (r.target === null) {
    return "within-cooldown";
  } // every eligible version is too fresh
  if (dep.kind === "bare") {
    return "bare→pinned";
  }
  if (dep.kind === "range") {
    return "range→exact";
  }
  // exact — but only an orderable stable triple can be compared against the target, so an
  // unorderable pin is reported as unresolved (non-actionable: no exit-1, no write) rather
  // than being mis-read as outdated.
  if (isUnorderableExact(dep)) {
    return "unresolved";
  }
  if (cmp(r.target, dep.spec) > 0) {
    return "outdated";
  }
  // target === current within major. A fresher within-major stable held back by the
  // cooldown is transient; a newer major is the deliberate --allow-major path.
  if (r.highestWithinMajor && cmp(r.highestWithinMajor, dep.spec) > 0) {
    return "within-cooldown";
  }
  if (r.newerMajor) {
    return "major-available";
  }
  return "up-to-date";
}

// --- Repo's own pins (for the shared-dep major-divergence note) --------------
async function readRepoPins(): Promise<Map<string, string>> {
  const pins = new Map<string, string>(); // name → exact/spec version
  for (const rel of ["package.json", "packages/cli/package.json"]) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(root, rel), "utf-8")
      );
      if (!isRecord(parsed)) {
        continue;
      }
      for (const bucket of DEP_BUCKETS) {
        const map = parsed[bucket];
        if (!isRecord(map)) {
          continue;
        }
        for (const [name, spec] of Object.entries(map)) {
          pins.set(name, String(spec));
        }
      }
    } catch {
      // ignore a missing manifest
    }
  }
  return pins;
}

// --- Report + write ----------------------------------------------------------
const STATUS_LABEL: Record<Status, string> = {
  "bare→pinned": "bare→pinned",
  "major-available": "major-available",
  outdated: "outdated",
  "range→exact": "range→exact",
  unresolved: "unresolved (registry error)",
  "up-to-date": "up-to-date",
  "within-cooldown": "within-cooldown (skipped)",
};

// --- Terminal presentation (clack + picocolors) ------------------------------
// stripAnsi / wrapForNote are duplicated from packages/cli/src/lib/tui.ts rather
// than imported: this is a standalone root script, and reaching across the package
// boundary into the CLI's TS source would drag in a build step. They're tiny.
// The control character is deliberate: this pattern exists to match ANSI escapes, which
// is exactly what `no-control-regex` flags. Suppressed here and at the original in
// packages/cli/src/lib/tui.ts, and nowhere else.
// oxlint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
// The escape itself, as an escape sequence rather than a literal control byte — a raw
// 0x1b in the source makes grep treat this whole file as binary and skip it.
const ESC = "\u001B";
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// Hard-wrap to the terminal width so a clack `note` box can't overflow the rail.
// Widths are measured on the ANSI-stripped text so colored words wrap by their
// visible length; words carrying ANSI codes are left whole (a raw slice could cut
// mid-escape).
function wrapForNote(text: string): string {
  const width = Math.max(24, (process.stdout.columns ?? 80) - 6);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let current = "";
    for (const word of line.split(" ")) {
      let chunk = word;
      while (stripAnsi(chunk).length > width && !chunk.includes(ESC)) {
        if (current) {
          out.push(current);
          current = "";
        }
        out.push(chunk.slice(0, width));
        chunk = chunk.slice(width);
      }
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (stripAnsi(candidate).length > width) {
        out.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
    out.push(current);
  }
  return out.join("\n");
}

// Semver bump level between two stable versions (null when either isn't a triple).
function semverDelta(cur: string, target: string): SemverLevel | null {
  const a = parseSemver(cur);
  const b = parseSemver(target);
  if (!a || !b) {
    return null;
  }
  if (b[0] !== a[0]) {
    return "major";
  }
  if (b[1] !== a[1]) {
    return "minor";
  }
  if (b[2] !== a[2]) {
    return "patch";
  }
  return "none";
}

const DELTA_COLOR = { major: pc.red, minor: pc.cyan, patch: pc.green };

// Color the target version by its bump level vs the current pin — npm-check-updates'
// scheme (red major / cyan minor / green patch) — dimming the unchanged leading
// segments so only the part that moved stands out. A non-exact current spec (range,
// bare) has no triple to diff, so the whole exact target reads cyan (a migration).
function colorTarget(cur: string, target: string): string {
  const delta = semverDelta(cur, target);
  if (!delta || delta === "none") {
    return pc.cyan(target);
  }
  // A bump level means both versions parsed, so this re-parse cannot fail — but fall
  // back to the migration color instead of asserting, so a later change to semverDelta
  // can never turn a report row into a crash.
  const b = parseSemver(target);
  if (!b) {
    return pc.cyan(target);
  }
  const first = delta === "major" ? 0 : delta === "minor" ? 1 : 2;
  const head = b.slice(0, first).join(".");
  const tail = b.slice(first).join(".");
  return (head ? pc.dim(`${head}.`) : "") + DELTA_COLOR[delta](tail);
}

// Which report group a row renders under. Actionable `outdated` rows split by bump
// level; migrations, held-back, and errors get their own groups; up-to-date is hidden.
function groupKey(row: Row): GroupKey {
  switch (row.status) {
    case "outdated": {
      // decideStatus only returns "outdated" with a resolved target, so the null arm is
      // unreachable; it falls to "patch", which is where a null delta already went.
      const target = row.resolved?.target;
      const d = target ? semverDelta(row.dep.spec, target) : null;
      return d === "major" ? "major" : d === "minor" ? "minor" : "patch";
    }
    case "range→exact":
    case "bare→pinned": {
      return "migration";
    }
    case "major-available": {
      return "major-available";
    }
    case "within-cooldown": {
      return "cooldown";
    }
    case "unresolved": {
      return "unresolved";
    }
    default: {
      return "up-to-date";
    }
  }
}

function renderRow(row: Row): string {
  const dev = row.dep.bucket === "devDependencies" ? pc.dim(" dev") : "";
  const file = pc.dim(relative(root, row.manifest.file));
  const name = pc.cyan(row.dep.name);
  if (row.status === "unresolved") {
    return `${name}${dev}  ${pc.red("registry error")}${row.error ? pc.dim(` — ${row.error}`) : ""}  ${file}`;
  }
  const cur = row.dep.spec === "" ? pc.dim("(bare)") : row.dep.spec;
  // within-cooldown points the arrow at the held-back within-major version so the row
  // reads as "waiting on this", not a phantom downgrade.
  const colored =
    row.status === "within-cooldown"
      ? pc.yellow(row.resolved?.highestWithinMajor ?? "—")
      : colorTarget(row.dep.spec, row.resolved?.target ?? "—");
  return `${name}${dev}  ${cur} ${pc.dim("→")} ${colored}  ${file}`;
}

// The dedicated "major available" row: current → highest existing major, in red. Shown
// for every dep with a newer major regardless of its within-major status, so a bump like
// `astro 5 → 7` always surfaces in its own section (and its own picker group).
function renderMajorRow(row: Row): string {
  const dev = row.dep.bucket === "devDependencies" ? pc.dim(" dev") : "";
  const file = pc.dim(relative(root, row.manifest.file));
  const name = pc.cyan(row.dep.name);
  const cur = row.dep.spec === "" ? pc.dim("(bare)") : row.dep.spec;
  return `${name}${dev}  ${cur} ${pc.dim("→")} ${pc.red(row.resolved?.highestOverall ?? "—")}  ${file}`;
}

// --- Update candidates -------------------------------------------------------
// One proposed write per (dep, kind). `primary` is the within-major exact pin — the safe
// default: pre-checked in the picker and applied by non-interactive runs. `major` is the
// cross-major bump to `targetOverall`, listed in its own group and UNchecked; a
// maintainer opts into it per-dep (picker) or wholesale (--allow-major). When both are
// chosen for one dep the write pass keeps the higher version, so major wins.
const PRIMARY_GROUP_TITLE = {
  migration: "Pin / migrate to exact",
  minor: "Minor",
  patch: "Patch",
};
const MAJOR_GROUP_TITLE = "Major — crosses a major, review before selecting";

function primaryGroupTitle(cur: string, target: string): string {
  const d = semverDelta(cur, target);
  if (d === "patch") {
    return PRIMARY_GROUP_TITLE.patch;
  }
  if (d === "minor") {
    return PRIMARY_GROUP_TITLE.minor;
  }
  return PRIMARY_GROUP_TITLE.migration; // range/bare migration — no diffable triple
}

function buildCandidates(rows: Row[]): Candidate[] {
  const out: Candidate[] = [];
  for (const row of rows) {
    const r = row.resolved;
    if (!r) {
      continue;
    }
    // Nothing is ever written over an unorderable exact pin — not even the opt-in major
    // arm below, which would otherwise cross a major on a spec we cannot compare.
    if (isUnorderableExact(row.dep)) {
      continue;
    }
    const cur = row.dep.spec;
    if (ACTIONABLE.has(row.status) && r.target && r.target !== cur) {
      out.push({
        group: primaryGroupTitle(cur, r.target),
        kind: "primary",
        row,
        target: r.target,
      });
    }
    if (r.newerMajor && r.targetOverall) {
      const mo = parseSemver(r.targetOverall);
      const cm = specMajor(cur);
      if (mo && cm !== null && mo[0] > cm && r.targetOverall !== cur) {
        out.push({
          group: MAJOR_GROUP_TITLE,
          kind: "major",
          row,
          target: r.targetOverall,
        });
      }
    }
  }
  return out;
}

// Picker label for a candidate: name [dev]  current → target (target colored by kind).
function candidateLabel(c: Candidate): string {
  const dev = c.row.dep.bucket === "devDependencies" ? pc.dim(" dev") : "";
  const cur = c.row.dep.spec === "" ? pc.dim("(bare)") : c.row.dep.spec;
  const tgt =
    c.kind === "major"
      ? pc.red(c.target)
      : colorTarget(c.row.dep.spec, c.target);
  return `${pc.cyan(c.row.dep.name)}${dev}  ${cur} ${pc.dim("→")} ${tgt}`;
}

// Post-selection summary line: solid, bold coloring with NO dimmed segments, so the "here's
// what you're about to apply" list stays clearly legible (unlike the diff-style dimming of
// the report/picker rows, which clack additionally dims when it echoes the submission).
function selectionLine(c: Candidate): string {
  const dev = c.row.dep.bucket === "devDependencies" ? pc.dim(" dev") : "";
  const cur = c.row.dep.spec === "" ? "(bare)" : c.row.dep.spec;
  const file = pc.dim(relative(root, c.row.manifest.file));
  const color =
    c.kind === "major"
      ? pc.red
      : semverDelta(c.row.dep.spec, c.target) === "patch"
        ? pc.green
        : pc.cyan;
  return `${pc.bold(pc.cyan(c.row.dep.name))}${dev}  ${cur} → ${pc.bold(color(c.target))}  ${file}`;
}

// The interactive group-picker + confirm. Returns the chosen candidates, or null when
// the maintainer cancelled, declined the confirm, or selected nothing (no files touched).
async function pickInteractive(
  candidates: Candidate[]
): Promise<Candidate[] | null> {
  const ORDER = [
    PRIMARY_GROUP_TITLE.patch,
    PRIMARY_GROUP_TITLE.minor,
    PRIMARY_GROUP_TITLE.migration,
    MAJOR_GROUP_TITLE,
  ];
  // An option's value is its index into `candidates`, so a pick maps straight back.
  const groups: Record<string, Option<number>[]> = {};
  for (const [i, c] of candidates.entries()) {
    (groups[c.group] ??= []).push({
      hint: relative(root, c.row.manifest.file),
      label: candidateLabel(c),
      value: i,
    });
  }
  const options: Record<string, Option<number>[]> = {};
  for (const title of ORDER) {
    const group = groups[title];
    if (group) {
      options[title] = group;
    }
  }

  const picked = await groupMultiselect<number>({
    groupSpacing: 1,
    initialValues: candidates.flatMap((c, i) =>
      c.kind === "primary" ? [i] : []
    ),
    message: "Select updates to apply",
    options,
    required: false,
    selectableGroups: true,
  });
  if (isCancel(picked)) {
    cancel("Update cancelled — no files changed.");
    return null;
  }
  if (picked.length === 0) {
    outro(pc.dim("Nothing selected — no files changed."));
    return null;
  }
  // Every index came out of the option list built above, so nothing is dropped here.
  const chosen = picked.flatMap((i) => candidates[i] ?? []);
  note(
    wrapForNote(chosen.map(selectionLine).join("\n")),
    pc.cyan(
      pc.bold(
        `Selected ${chosen.length} update${chosen.length === 1 ? "" : "s"}`
      )
    )
  );
  const ok = await confirm({
    message: `Apply ${chosen.length} update${chosen.length === 1 ? "" : "s"}?`,
  });
  if (isCancel(ok) || !ok) {
    cancel("Update cancelled — no files changed.");
    return null;
  }
  return chosen;
}

async function main(): Promise<void> {
  const minMinutes = await readMinReleaseMinutes();
  const discovered = await discoverManifests();
  const repoPins = await readRepoPins();

  intro(pc.bgCyan(pc.black(flags.check ? " deps:check " : " deps:update ")));
  const days = (minMinutes / 60 / 24).toFixed(0);
  log.info(
    pc.dim(
      `exact pins · within-major · ${minMinutes}min (${days}d) cooldown` +
        `${flags.allowMajor ? " · --allow-major" : ""}${flags.allowFresh ? " · --allow-fresh" : ""}`
    )
  );

  // Flatten every scannable dep across manifests, then resolve them in parallel (bounded)
  // behind a progress spinner. Each read manifest carries its own parsed document, which
  // the write pass rewrites in place.
  const manifests: Manifest[] = [];
  const jobs: Job[] = [];
  for (const discoveredManifest of discovered) {
    const manifest = await readManifestDeps(discoveredManifest);
    manifests.push(manifest);
    for (const dep of manifest.deps) {
      jobs.push({ manifest, dep });
    }
  }

  const s = spinner();
  s.start(
    `Resolving ${jobs.length} dependenc${jobs.length === 1 ? "y" : "ies"} from npm`
  );
  let done = 0;
  const rows = await mapWithConcurrency(jobs, 12, async ({ manifest, dep }) => {
    let row: Row;
    try {
      const resolved = await resolveVersion(
        dep.name,
        specMajor(dep.spec),
        minMinutes
      );
      row = { dep, manifest, resolved, status: decideStatus(dep, resolved) };
    } catch (error) {
      row = {
        manifest,
        dep,
        resolved: null,
        status: "unresolved",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    s.message(`Resolved ${++done}/${jobs.length} — ${dep.name}`);
    return row;
  });
  s.stop(
    `Resolved ${jobs.length} dependenc${jobs.length === 1 ? "y" : "ies"} from npm`
  );

  // Informational: a shared dep whose major diverges from the repo's own pin. Built after
  // resolution so the note order stays stable regardless of parallel completion order.
  const notes: string[] = [];
  for (const { dep } of rows.filter((r) => r.resolved)) {
    const repoSpec = repoPins.get(dep.name);
    if (
      repoSpec &&
      specMajor(repoSpec) !== null &&
      specMajor(dep.spec) !== null &&
      specMajor(repoSpec) !== specMajor(dep.spec)
    ) {
      notes.push(
        `${dep.name}: template pins major ${specMajor(dep.spec)} vs repo's ${specMajor(repoSpec)} (${repoSpec}) — resolved independently.`
      );
    }
  }

  printReport(rows, notes);

  if (flags.check) {
    // Read-only CI gate: exit non-zero only on what a default deps:update would change.
    const pending = rows.filter((r) => ACTIONABLE.has(r.status)).length;
    outro(
      pending > 0
        ? pc.yellow(`${pending} pending — run ${pc.bold("pnpm deps:update")}`)
        : pc.green("up to date")
    );
    process.exit(pending > 0 ? 1 : 0);
  }

  const candidates = buildCandidates(rows);
  if (candidates.length === 0) {
    outro(pc.green("Nothing to update — every scanned dependency is current."));
    return;
  }

  let toWrite: Candidate[];
  if (flags.dryRun) {
    // Preview only: never prompt. Show exactly what a default apply would change (every
    // primary bump, plus majors only with --allow-major); writeUpdates prints the
    // "would update" lines and writes nothing.
    toWrite = candidates.filter(
      (c) => c.kind === "primary" || flags.allowMajor
    );
  } else if (process.stdout.isTTY && !flags.yes) {
    // TTY: always pick + confirm. Primaries pre-checked; majors listed, unchecked.
    const picked = await pickInteractive(candidates);
    if (picked === null) {
      return;
    } // cancelled, declined, or nothing selected
    toWrite = picked;
  } else {
    // Non-interactive (--yes or piped): every primary bump, plus majors only when the
    // maintainer explicitly opted in with --allow-major.
    if (!process.stdout.isTTY && !flags.yes) {
      log.info(
        pc.dim(
          "Non-TTY — applying all eligible updates (pass -y in a TTY to skip the picker)."
        )
      );
    }
    toWrite = candidates.filter(
      (c) => c.kind === "primary" || flags.allowMajor
    );
  }

  await writeUpdates(manifests, toWrite);
}

function printReport(rows: Row[], notes: string[]): void {
  const buckets = new Map<GroupKey, Row[]>();
  for (const row of rows) {
    const key = groupKey(row);
    if (key === "up-to-date") {
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  let shown = 0;
  const section = (
    groupRows: Row[] | undefined,
    color: Colorize,
    title: string,
    renderer: (row: Row) => string = renderRow
  ) => {
    if (!groupRows || groupRows.length === 0) {
      return;
    }
    shown += groupRows.length;
    note(
      wrapForNote(groupRows.map(renderer).join("\n")),
      color(`${title} ${pc.dim(`(${groupRows.length})`)}`)
    );
  };

  // Within-major actions first, split by bump level, then a dedicated section for every
  // dep with a newer major (shown regardless of its within-major status), then held-back
  // and errors. Majors get their own box so a bump like `astro 5 → 7` never hides inside
  // a migration row.
  section(buckets.get("minor"), pc.cyan, "Minor");
  section(buckets.get("patch"), pc.green, "Patch");
  section(buckets.get("migration"), pc.cyan, "Pin / migrate to exact");
  section(
    rows.filter((r) => r.resolved?.newerMajor),
    pc.red,
    "Major available — crosses a major",
    renderMajorRow
  );
  section(buckets.get("cooldown"), pc.yellow, "Within cooldown — held back");
  section(buckets.get("unresolved"), pc.red, "Unresolved — registry error");

  if (notes.length) {
    note(
      wrapForNote(notes.map((n) => pc.dim(`• ${n}`)).join("\n")),
      pc.dim("Notes")
    );
  }

  if (rows.length === 0) {
    log.warn("No dependencies found to scan.");
    return;
  }
  const counts = new Map<Status, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  const summary = [...counts]
    .map(([st, n]) => `${n} ${STATUS_LABEL[st]}`)
    .join(pc.dim(" · "));
  log.info(summary);
  if (shown === 0) {
    log.success("All scanned dependencies are up to date.");
  }
}

// Rewrite each manifest's deps to the chosen exact version, preserving key order and JSON
// formatting (2-space, trailing newline). `toWrite` is the list of chosen candidates
// ({ row, target, kind }); duplicates for one (file, bucket, name) collapse to the higher
// version, so a selected major overrides its within-major primary.
async function writeUpdates(
  manifests: Manifest[],
  toWrite: Candidate[]
): Promise<void> {
  const byKey = new Map<string, Candidate>();
  for (const c of toWrite) {
    const key = `${c.row.manifest.file} ${c.row.dep.bucket} ${c.row.dep.name}`;
    const prev = byKey.get(key);
    if (!prev || cmp(c.target, prev.target) > 0) {
      byKey.set(key, c);
    }
  }

  const byFile = new Map<string, Candidate[]>();
  for (const c of byKey.values()) {
    const fileCands = byFile.get(c.row.manifest.file);
    if (fileCands) {
      fileCands.push(c);
    } else {
      byFile.set(c.row.manifest.file, [c]);
    }
  }

  let changed = 0;
  for (const manifest of manifests) {
    const fileCands = byFile.get(manifest.file);
    if (!fileCands || fileCands.length === 0) {
      continue;
    }
    const { json } = manifest;

    for (const c of fileCands) {
      const { dep } = c.row;
      const { target } = c;
      if (manifest.kind === "package-json") {
        // The bucket was read out of this same document, so it is present and an object.
        // Throwing beats inventing a bucket in a manifest that never had one.
        const bucket = json[dep.bucket];
        if (!isRecord(bucket)) {
          throw new Error(`${manifest.file}: "${dep.bucket}" is not an object`);
        }
        bucket[dep.name] = target;
      } else {
        const arr = json[dep.bucket];
        if (!Array.isArray(arr)) {
          throw new TypeError(
            `${manifest.file}: "${dep.bucket}" is not an array`
          );
        }
        const idx = arr.findIndex((e: unknown) => {
          const entry = String(e);
          const at = entry.lastIndexOf("@");
          return (at > 0 ? entry.slice(0, at) : entry) === dep.name;
        });
        if (idx !== -1) {
          arr[idx] = `${dep.name}@${target}`;
        }
      }
      changed++;
      log.step(
        `${pc.dim(relative(root, manifest.file))}  ${pc.cyan(dep.name)} ` +
          `${dep.spec || pc.dim("(bare)")} ${pc.dim("→")} ${
            c.kind === "major" ? pc.red(target) : colorTarget(dep.spec, target)
          }`
      );
    }

    if (!flags.dryRun) {
      await writeFile(
        manifest.file,
        `${JSON.stringify(json, null, 2)}\n`,
        "utf-8"
      );
    }
  }

  const verb = flags.dryRun ? "would update" : "updated";
  outro(
    changed === 0
      ? pc.dim("Nothing to update.")
      : `${flags.dryRun ? pc.yellow("dry run — ") : ""}${verb} ${pc.bold(String(changed))} ${
          changed === 1 ? "dependency" : "dependencies"
        }.`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
