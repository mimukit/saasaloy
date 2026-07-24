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

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
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
import pc from "picocolors";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- CLI flags ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {
  check: argv.includes("--check"),
  allowMajor: argv.includes("--allow-major"),
  allowFresh: argv.includes("--allow-fresh"),
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
    "usage: update-deps.mjs [--check] [--allow-major] [--allow-fresh] [--dry-run] [--yes|-y]",
  );
  process.exit(2);
}

// --- Skip rules: specs that aren't resolvable npm registry versions ----------
// A dep is skipped when its NAME is an internal workspace package or its VERSION
// spec is a non-registry protocol — pnpm owns those, not this tool.
function isSkippedName(name) {
  return name.startsWith("@repo/");
}
function isSkippedSpec(spec) {
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

function classifySpec(spec) {
  if (spec === "" || spec === "latest" || spec === "*") return "bare";
  if (EXACT_RE.test(spec)) return "exact";
  return "range";
}

// Leading major number of a spec, or null when there's nothing to anchor to (bare).
function specMajor(spec) {
  const m = spec.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// --- Semver (stable-only) compare --------------------------------------------
// We only ever compare stable versions (prereleases are dropped before this), so a
// plain numeric triple compare is sufficient — no prerelease-precedence rules needed.
function parseStable(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmp(a, b) {
  const pa = parseStable(a);
  const pb = parseStable(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// --- pnpm-workspace.yaml: minimumReleaseAge (single source of truth) ---------
async function readMinReleaseMinutes() {
  const text = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
  // Match the active (non-commented) `minimumReleaseAge: <n>` line.
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*minimumReleaseAge:\s*(\d+)\s*$/);
    if (m) return Number(m[1]);
  }
  return 0; // no cooldown configured → nothing is quarantined
}

// --- npm registry resolution -------------------------------------------------
// Cache the in-flight PROMISE (not just the resolved value): with parallel resolution the
// same package can be requested by several manifests at once, and caching the promise means
// they share a single fetch instead of racing duplicates.
const registryCache = new Map();

function fetchPackument(name) {
  const cached = registryCache.get(name);
  if (cached) return cached;
  const p = (async () => {
    const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`registry ${res.status} for ${name}`);
    return res.json();
  })();
  registryCache.set(name, p);
  return p;
}

// Run an async fn over items with bounded concurrency, preserving input order in the
// results array. Resolves the whole dependency set far faster than a serial loop while
// keeping npm from seeing a burst of hundreds of simultaneous requests.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Resolve the versions deps:update could pin for one dep, plus the context the report
// needs. `target` is the within-major pin (the safe default, independent of any flag);
// `targetOverall` is the highest cooldown-eligible version across ALL majors — what a
// deliberate major bump would write. Returns
// { target, targetOverall, highestWithinMajor, highestOverall, newerMajor }.
async function resolveVersion(name, curMajor, minMinutes) {
  const doc = await fetchPackument(name);
  const times = doc.time ?? {};
  const now = Date.now();
  const cooldownMs = minMinutes * 60 * 1000;

  const stable = Object.keys(doc.versions ?? {}).filter((v) => parseStable(v) !== null);
  stable.sort(cmp);

  const clearsCooldown = (v) => {
    if (flags.allowFresh) return true;
    const t = times[v];
    return t ? now - Date.parse(t) >= cooldownMs : false;
  };

  // The within-major cap is a property of the dep, not a flag: majors are opted into
  // per-dep in the picker (or with --allow-major for non-interactive runs), never by
  // silently lifting the cap here. Bare specs have no anchor, so nothing to cap against.
  const withinMajor = (v) => curMajor === null || parseStable(v)[0] === curMajor;

  const capped = stable.filter(withinMajor);
  const highestWithinMajor = capped.length ? capped[capped.length - 1] : null;
  const highestOverall = stable.length ? stable[stable.length - 1] : null;
  const eligibleWithin = capped.filter(clearsCooldown);
  const target = eligibleWithin.length ? eligibleWithin[eligibleWithin.length - 1] : null;
  const eligibleAll = stable.filter(clearsCooldown);
  const targetOverall = eligibleAll.length ? eligibleAll[eligibleAll.length - 1] : null;
  const newerMajor =
    curMajor !== null && highestOverall !== null && parseStable(highestOverall)[0] > curMajor;

  return { target, targetOverall, highestWithinMajor, highestOverall, newerMajor };
}

// --- Manifest discovery ------------------------------------------------------
// Three "invisible" manifest classes, structured as globs so the third (scaffolded
// module workspaces) is already wired even though no create-module scaffold ships a
// package.json yet.
async function walk(dir, match, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // directory doesn't exist (e.g. empty modules/) — nothing to scan
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await walk(abs, match, out);
    } else if (match(abs)) {
      out.push(abs);
    }
  }
  return out;
}

async function discoverManifests() {
  const manifests = [];

  // Class 1: base template package.jsons (object-form deps/devDeps).
  for (const file of await walk(
    join(root, "packages/cli/templates/base"),
    (f) => f.endsWith("package.json"),
    [],
  )) {
    manifests.push({ file, kind: "package-json" });
  }

  // Class 2: module descriptors (array-form dependencies[]/devDependencies[]).
  for (const file of await walk(
    join(root, "modules"),
    (f) => f.endsWith("registry-item.json"),
    [],
  )) {
    manifests.push({ file, kind: "registry-item" });
  }

  // Class 3: scaffolded module workspace package.jsons (object-form). No-op until a
  // create-module scaffold ships one, but the glob is wired now.
  for (const file of await walk(
    join(root, "modules"),
    (f) => f.endsWith("package.json") && f.includes(`${join("", "files", "")}`),
    [],
  )) {
    manifests.push({ file, kind: "package-json" });
  }

  return manifests;
}

// Extract the scannable deps from a manifest as a flat list of
// { bucket, name, spec, kind }. `bucket` is "dependencies" | "devDependencies".
async function readManifestDeps(manifest) {
  const raw = await readFile(manifest.file, "utf8");
  const json = JSON.parse(raw);
  const deps = [];

  const pushObject = (bucket) => {
    for (const [name, spec] of Object.entries(json[bucket] ?? {})) {
      if (isSkippedName(name) || isSkippedSpec(String(spec))) continue;
      deps.push({ bucket, name, spec: String(spec), kind: classifySpec(String(spec)) });
    }
  };
  const pushArray = (bucket) => {
    for (const entry of json[bucket] ?? []) {
      const at = entry.lastIndexOf("@");
      const name = at > 0 ? entry.slice(0, at) : entry;
      const spec = at > 0 ? entry.slice(at + 1) : "";
      if (isSkippedName(name) || isSkippedSpec(spec)) continue;
      deps.push({ bucket, name, spec, kind: classifySpec(spec) });
    }
  };

  if (manifest.kind === "package-json") {
    pushObject("dependencies");
    pushObject("devDependencies");
  } else {
    pushArray("dependencies");
    pushArray("devDependencies");
  }
  return { json, raw, deps };
}

// --- Status decision ---------------------------------------------------------
// Reduce a resolved dep to one status. Actionable statuses (what a default
// deps:update would change) drive the non-zero exit code; the rest are informational.
const ACTIONABLE = new Set(["outdated", "range→exact", "bare→pinned"]);

function decideStatus(dep, r) {
  if (r.target === null) return "within-cooldown"; // every eligible version is too fresh
  if (dep.kind === "bare") return "bare→pinned";
  if (dep.kind === "range") return "range→exact";
  // exact
  if (cmp(r.target, dep.spec) > 0) return "outdated";
  // target === current within major. A fresher within-major stable held back by the
  // cooldown is transient; a newer major is the deliberate --allow-major path.
  if (r.highestWithinMajor && cmp(r.highestWithinMajor, dep.spec) > 0) return "within-cooldown";
  if (r.newerMajor) return "major-available";
  return "up-to-date";
}

// --- Repo's own pins (for the shared-dep major-divergence note) --------------
async function readRepoPins() {
  const pins = new Map(); // name → exact/spec version
  for (const rel of ["package.json", "packages/cli/package.json"]) {
    try {
      const json = JSON.parse(await readFile(join(root, rel), "utf8"));
      for (const bucket of ["dependencies", "devDependencies"]) {
        for (const [name, spec] of Object.entries(json[bucket] ?? {})) {
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
const STATUS_LABEL = {
  "up-to-date": "up-to-date",
  outdated: "outdated",
  "range→exact": "range→exact",
  "bare→pinned": "bare→pinned",
  "major-available": "major-available",
  "within-cooldown": "within-cooldown (skipped)",
  unresolved: "unresolved (registry error)",
};

// --- Terminal presentation (clack + picocolors) ------------------------------
// stripAnsi / wrapForNote are duplicated from packages/cli/src/lib/tui.ts rather
// than imported: this is a standalone root .mjs, and reaching across the package
// boundary into the CLI's TS source would drag in a build step. They're tiny.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

// Hard-wrap to the terminal width so a clack `note` box can't overflow the rail.
// Widths are measured on the ANSI-stripped text so colored words wrap by their
// visible length; words carrying ANSI codes are left whole (a raw slice could cut
// mid-escape).
function wrapForNote(text) {
  const width = Math.max(24, (process.stdout.columns ?? 80) - 6);
  const out = [];
  for (const line of text.split("\n")) {
    let current = "";
    for (const word of line.split(" ")) {
      let chunk = word;
      while (stripAnsi(chunk).length > width && !chunk.includes("")) {
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
function semverDelta(cur, target) {
  const a = parseStable(cur);
  const b = parseStable(target);
  if (!a || !b) return null;
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  if (b[2] !== a[2]) return "patch";
  return "none";
}

const DELTA_COLOR = { major: pc.red, minor: pc.cyan, patch: pc.green };

// Color the target version by its bump level vs the current pin — npm-check-updates'
// scheme (red major / cyan minor / green patch) — dimming the unchanged leading
// segments so only the part that moved stands out. A non-exact current spec (range,
// bare) has no triple to diff, so the whole exact target reads cyan (a migration).
function colorTarget(cur, target) {
  const delta = semverDelta(cur, target);
  if (!delta || delta === "none") return pc.cyan(target);
  const b = parseStable(target);
  const first = delta === "major" ? 0 : delta === "minor" ? 1 : 2;
  const head = b.slice(0, first).join(".");
  const tail = b.slice(first).join(".");
  return (head ? pc.dim(`${head}.`) : "") + DELTA_COLOR[delta](tail);
}

// Which report group a row renders under. Actionable `outdated` rows split by bump
// level; migrations, held-back, and errors get their own groups; up-to-date is hidden.
function groupKey(row) {
  switch (row.status) {
    case "outdated": {
      const d = semverDelta(row.dep.spec, row.resolved?.target);
      return d === "major" ? "major" : d === "minor" ? "minor" : "patch";
    }
    case "range→exact":
    case "bare→pinned":
      return "migration";
    case "major-available":
      return "major-available";
    case "within-cooldown":
      return "cooldown";
    case "unresolved":
      return "unresolved";
    default:
      return "up-to-date";
  }
}

function renderRow(row) {
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
function renderMajorRow(row) {
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
  patch: "Patch",
  minor: "Minor",
  migration: "Pin / migrate to exact",
};
const MAJOR_GROUP_TITLE = "Major — crosses a major, review before selecting";

function primaryGroupTitle(row) {
  const d = semverDelta(row.dep.spec, row.resolved.target);
  if (d === "patch") return PRIMARY_GROUP_TITLE.patch;
  if (d === "minor") return PRIMARY_GROUP_TITLE.minor;
  return PRIMARY_GROUP_TITLE.migration; // range/bare migration — no diffable triple
}

function buildCandidates(rows) {
  const out = [];
  for (const row of rows) {
    const r = row.resolved;
    if (!r) continue;
    const cur = row.dep.spec;
    if (ACTIONABLE.has(row.status) && r.target && r.target !== cur) {
      out.push({ row, target: r.target, kind: "primary", group: primaryGroupTitle(row) });
    }
    if (r.newerMajor && r.targetOverall) {
      const mo = parseStable(r.targetOverall);
      const cm = specMajor(cur);
      if (mo && cm !== null && mo[0] > cm && r.targetOverall !== cur) {
        out.push({ row, target: r.targetOverall, kind: "major", group: MAJOR_GROUP_TITLE });
      }
    }
  }
  return out;
}

// Picker label for a candidate: name [dev]  current → target (target colored by kind).
function candidateLabel(c) {
  const dev = c.row.dep.bucket === "devDependencies" ? pc.dim(" dev") : "";
  const cur = c.row.dep.spec === "" ? pc.dim("(bare)") : c.row.dep.spec;
  const tgt = c.kind === "major" ? pc.red(c.target) : colorTarget(c.row.dep.spec, c.target);
  return `${pc.cyan(c.row.dep.name)}${dev}  ${cur} ${pc.dim("→")} ${tgt}`;
}

// The interactive group-picker + confirm. Returns the chosen candidates, or null when
// the maintainer cancelled, declined the confirm, or selected nothing (no files touched).
async function pickInteractive(candidates) {
  const ORDER = [
    PRIMARY_GROUP_TITLE.patch,
    PRIMARY_GROUP_TITLE.minor,
    PRIMARY_GROUP_TITLE.migration,
    MAJOR_GROUP_TITLE,
  ];
  const groups = {};
  candidates.forEach((c, i) => {
    (groups[c.group] ??= []).push({
      value: i,
      label: candidateLabel(c),
      hint: relative(root, c.row.manifest.file),
    });
  });
  const options = {};
  for (const title of ORDER) if (groups[title]) options[title] = groups[title];

  const picked = await groupMultiselect({
    message: "Select updates to apply",
    options,
    initialValues: candidates.flatMap((c, i) => (c.kind === "primary" ? [i] : [])),
    required: false,
    selectableGroups: true,
    groupSpacing: 1,
  });
  if (isCancel(picked)) {
    cancel("Update cancelled — no files changed.");
    return null;
  }
  if (picked.length === 0) {
    outro(pc.dim("Nothing selected — no files changed."));
    return null;
  }
  const chosen = picked.map((i) => candidates[i]);
  const ok = await confirm({
    message: `Apply ${chosen.length} update${chosen.length === 1 ? "" : "s"}?`,
  });
  if (isCancel(ok) || !ok) {
    cancel("Update cancelled — no files changed.");
    return null;
  }
  return chosen;
}

async function main() {
  const minMinutes = await readMinReleaseMinutes();
  const manifests = await discoverManifests();
  const repoPins = await readRepoPins();

  intro(pc.bgCyan(pc.black(flags.check ? " deps:check " : " deps:update ")));
  const days = (minMinutes / 60 / 24).toFixed(0);
  log.info(
    pc.dim(
      `exact pins · within-major · ${minMinutes}min (${days}d) cooldown` +
        `${flags.allowMajor ? " · --allow-major" : ""}${flags.allowFresh ? " · --allow-fresh" : ""}`,
    ),
  );

  // Flatten every scannable dep across manifests, then resolve them in parallel (bounded)
  // behind a progress spinner.
  const jobs = [];
  for (const manifest of manifests) {
    const { json, deps } = await readManifestDeps(manifest);
    manifest._json = json; // stash the parsed doc for the write pass
    for (const dep of deps) jobs.push({ manifest, dep });
  }

  const s = spinner();
  s.start(`Resolving ${jobs.length} dependenc${jobs.length === 1 ? "y" : "ies"} from npm`);
  let done = 0;
  const rows = await mapWithConcurrency(jobs, 12, async ({ manifest, dep }) => {
    let row;
    try {
      const resolved = await resolveVersion(dep.name, specMajor(dep.spec), minMinutes);
      row = { manifest, dep, resolved, status: decideStatus(dep, resolved) };
    } catch (err) {
      row = { manifest, dep, resolved: null, status: "unresolved", error: err.message };
    }
    s.message(`Resolved ${++done}/${jobs.length} — ${dep.name}`);
    return row;
  });
  s.stop(`Resolved ${jobs.length} dependenc${jobs.length === 1 ? "y" : "ies"} from npm`);

  // Informational: a shared dep whose major diverges from the repo's own pin. Built after
  // resolution so the note order stays stable regardless of parallel completion order.
  const notes = [];
  for (const { dep } of rows.filter((r) => r.resolved)) {
    const repoSpec = repoPins.get(dep.name);
    if (
      repoSpec &&
      specMajor(repoSpec) !== null &&
      specMajor(dep.spec) !== null &&
      specMajor(repoSpec) !== specMajor(dep.spec)
    ) {
      notes.push(
        `${dep.name}: template pins major ${specMajor(dep.spec)} vs repo's ${specMajor(repoSpec)} (${repoSpec}) — resolved independently.`,
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
        : pc.green("up to date"),
    );
    process.exit(pending > 0 ? 1 : 0);
  }

  const candidates = buildCandidates(rows);
  if (candidates.length === 0) {
    outro(pc.green("Nothing to update — every scanned dependency is current."));
    return;
  }

  let toWrite;
  if (process.stdout.isTTY && !flags.yes) {
    // TTY: always pick + confirm. Primaries pre-checked; majors listed, unchecked.
    toWrite = await pickInteractive(candidates);
    if (toWrite === null) return; // cancelled, declined, or nothing selected
  } else {
    // Non-interactive (--yes or piped): every primary bump, plus majors only when the
    // maintainer explicitly opted in with --allow-major.
    if (!process.stdout.isTTY && !flags.yes) {
      log.info(
        pc.dim("Non-TTY — applying all eligible updates (pass -y in a TTY to skip the picker)."),
      );
    }
    toWrite = candidates.filter((c) => c.kind === "primary" || flags.allowMajor);
  }

  await writeUpdates(manifests, toWrite);
}

function printReport(rows, notes) {
  const buckets = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    if (key === "up-to-date") continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  let shown = 0;
  const section = (groupRows, color, title, renderer = renderRow) => {
    if (!groupRows || groupRows.length === 0) return;
    shown += groupRows.length;
    note(
      wrapForNote(groupRows.map(renderer).join("\n")),
      color(`${title} ${pc.dim(`(${groupRows.length})`)}`),
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
    renderMajorRow,
  );
  section(buckets.get("cooldown"), pc.yellow, "Within cooldown — held back");
  section(buckets.get("unresolved"), pc.red, "Unresolved — registry error");

  if (notes.length) {
    note(wrapForNote(notes.map((n) => pc.dim(`• ${n}`)).join("\n")), pc.dim("Notes"));
  }

  if (rows.length === 0) {
    log.warn("No dependencies found to scan.");
    return;
  }
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([st, n]) => `${n} ${STATUS_LABEL[st] ?? st}`)
    .join(pc.dim(" · "));
  log.info(summary);
  if (shown === 0) log.success("All scanned dependencies are up to date.");
}

// Rewrite each manifest's deps to the chosen exact version, preserving key order and JSON
// formatting (2-space, trailing newline). `toWrite` is the list of chosen candidates
// ({ row, target, kind }); duplicates for one (file, bucket, name) collapse to the higher
// version, so a selected major overrides its within-major primary.
async function writeUpdates(manifests, toWrite) {
  const byKey = new Map();
  for (const c of toWrite) {
    const key = `${c.row.manifest.file} ${c.row.dep.bucket} ${c.row.dep.name}`;
    const prev = byKey.get(key);
    if (!prev || cmp(c.target, prev.target) > 0) byKey.set(key, c);
  }

  const byFile = new Map();
  for (const c of byKey.values()) {
    if (!byFile.has(c.row.manifest.file)) byFile.set(c.row.manifest.file, []);
    byFile.get(c.row.manifest.file).push(c);
  }

  let changed = 0;
  for (const manifest of manifests) {
    const fileCands = byFile.get(manifest.file);
    if (!fileCands || fileCands.length === 0) continue;
    const json = manifest._json;

    for (const c of fileCands) {
      const { dep } = c.row;
      const target = c.target;
      if (manifest.kind === "package-json") {
        json[dep.bucket][dep.name] = target;
      } else {
        const arr = json[dep.bucket];
        const idx = arr.findIndex((e) => {
          const at = e.lastIndexOf("@");
          return (at > 0 ? e.slice(0, at) : e) === dep.name;
        });
        if (idx !== -1) arr[idx] = `${dep.name}@${target}`;
      }
      changed++;
      log.step(
        `${pc.dim(relative(root, manifest.file))}  ${pc.cyan(dep.name)} ` +
          `${dep.spec || pc.dim("(bare)")} ${pc.dim("→")} ${
            c.kind === "major" ? pc.red(target) : colorTarget(dep.spec, target)
          }`,
      );
    }

    if (!flags.dryRun) {
      await writeFile(manifest.file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    }
  }

  const verb = flags.dryRun ? "would update" : "updated";
  outro(
    changed === 0
      ? pc.dim("Nothing to update.")
      : `${flags.dryRun ? pc.yellow("dry run — ") : ""}${verb} ${pc.bold(String(changed))} ${
          changed === 1 ? "dependency" : "dependencies"
        }.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
