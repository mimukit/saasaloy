// Maintainer dependency-update workflow for the files pnpm's own tooling can't see:
// the base-template package.jsons and the module descriptors. These ship dependency
// versions to downstream projects but aren't pnpm workspace members, so `pnpm outdated`
// / `pnpm update` never touch them — and because we pin EXACT versions, pnpm's
// install-time `minimumReleaseAge` cooldown has nothing to resolve and never applies
// either. This script is therefore the ONLY place a supply-chain cooldown can gate
// these files, enforced here at version-SELECTION time (ADR 0016).
//
//   pnpm deps:check   → read-only drift report (this script with --check)
//   pnpm deps:update  → rewrite to the resolved exact versions (no --check)
//
// Zero-dep, Node 24: node:fs + global fetch, matching scripts/watch-template.mjs.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- CLI flags ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {
  check: argv.includes("--check"),
  allowMajor: argv.includes("--allow-major"),
  allowFresh: argv.includes("--allow-fresh"),
  dryRun: argv.includes("--dry-run"),
};
const KNOWN = new Set(["--check", "--allow-major", "--allow-fresh", "--dry-run"]);
const unknown = argv.filter((a) => a.startsWith("-") && !KNOWN.has(a));
if (unknown.length > 0) {
  console.error(`Unknown flag(s): ${unknown.join(", ")}`);
  console.error("usage: update-deps.mjs [--check] [--allow-major] [--allow-fresh] [--dry-run]");
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
const registryCache = new Map();

async function fetchPackument(name) {
  if (registryCache.has(name)) return registryCache.get(name);
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`registry ${res.status} for ${name}`);
  }
  const json = await res.json();
  registryCache.set(name, json);
  return json;
}

// Resolve the version deps:update WOULD pin for one dep, plus the context the report
// needs. Returns { target, highestWithinMajor, highestOverall, newerMajor, eligible }.
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

  // Whether to stay within the anchor major. Bare specs have no anchor, and
  // --allow-major lifts the cap; otherwise cap at the current major.
  const withinCap = (v) =>
    flags.allowMajor || curMajor === null ? true : parseStable(v)[0] === curMajor;

  const capped = stable.filter(withinCap);
  const highestWithinMajor = capped.length ? capped[capped.length - 1] : null;
  const highestOverall = stable.length ? stable[stable.length - 1] : null;
  const eligible = capped.filter(clearsCooldown);
  const target = eligible.length ? eligible[eligible.length - 1] : null;
  const newerMajor =
    curMajor !== null && highestOverall !== null && parseStable(highestOverall)[0] > curMajor;

  return { target, highestWithinMajor, highestOverall, newerMajor };
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

async function main() {
  const minMinutes = await readMinReleaseMinutes();
  const manifests = await discoverManifests();
  const repoPins = await readRepoPins();

  const rows = []; // { manifest, dep, resolved, status }
  const notes = [];

  for (const manifest of manifests) {
    const { json, deps } = await readManifestDeps(manifest);
    manifest._json = json; // stash the parsed doc for the write pass
    for (const dep of deps) {
      let resolved;
      try {
        resolved = await resolveVersion(dep.name, specMajor(dep.spec), minMinutes);
      } catch (err) {
        rows.push({ manifest, dep, resolved: null, status: "unresolved", error: err.message });
        continue;
      }
      const status = decideStatus(dep, resolved);
      rows.push({ manifest, dep, resolved, status });

      // Informational: a shared dep whose major diverges from the repo's own pin.
      const repoSpec = repoPins.get(dep.name);
      if (repoSpec && specMajor(repoSpec) !== null && specMajor(dep.spec) !== null) {
        if (specMajor(repoSpec) !== specMajor(dep.spec)) {
          notes.push(
            `${dep.name}: template pins major ${specMajor(dep.spec)} vs repo's ${specMajor(repoSpec)} (${repoSpec}) — resolved independently.`,
          );
        }
      }
    }
  }

  printReport(rows, notes, minMinutes);

  const actionable = rows.filter((r) => ACTIONABLE.has(r.status));

  if (flags.check) {
    // Exit non-zero only on what a default deps:update would change.
    process.exit(actionable.length > 0 ? 1 : 0);
  }

  await writeUpdates(manifests, rows);
}

function printReport(rows, notes, minMinutes) {
  const days = (minMinutes / 60 / 24).toFixed(0);
  console.log(
    `\nDependency drift — exact pins, within-major, ${minMinutes}min (${days}d) cooldown` +
      `${flags.allowMajor ? " [--allow-major]" : ""}${flags.allowFresh ? " [--allow-fresh]" : ""}\n`,
  );

  const byFile = new Map();
  for (const row of rows) {
    const key = relative(root, row.manifest.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(row);
  }

  for (const [file, fileRows] of byFile) {
    console.log(file);
    for (const row of fileRows) {
      const cur = row.dep.spec === "" ? "(bare)" : row.dep.spec;
      // For within-cooldown / major-available, point the arrow at the version being
      // held back so the report reads as "waiting on this", not a phantom downgrade.
      const latest =
        row.status === "within-cooldown"
          ? (row.resolved?.highestWithinMajor ?? "—")
          : row.status === "major-available"
            ? (row.resolved?.highestOverall ?? "—")
            : (row.resolved?.target ?? "—");
      const label = STATUS_LABEL[row.status] ?? row.status;
      const bucketTag = row.dep.bucket === "devDependencies" ? " (dev)" : "";
      console.log(
        `  ${row.dep.name}${bucketTag}  ${cur} → ${latest}  [${label}]` +
          `${row.error ? ` ${row.error}` : ""}`,
      );
    }
    console.log("");
  }

  for (const note of notes) console.log(`note: ${note}`);
  if (notes.length) console.log("");

  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([s, n]) => `${n} ${STATUS_LABEL[s] ?? s}`)
    .join(", ");
  console.log(summary || "no dependencies found");
}

// Rewrite each manifest's deps to the resolved exact version, preserving key order and
// JSON formatting (2-space, trailing newline). Only rows deps:update should act on are
// written: actionable always; major-available only with --allow-major; within-cooldown
// only with --allow-fresh (both already fold into `target` via the resolver flags).
async function writeUpdates(manifests, rows) {
  const rowsByFile = new Map();
  for (const row of rows) {
    if (!rowsByFile.has(row.manifest.file)) rowsByFile.set(row.manifest.file, []);
    rowsByFile.get(row.manifest.file).push(row);
  }

  let changed = 0;
  for (const manifest of manifests) {
    const fileRows = rowsByFile.get(manifest.file) ?? [];
    const json = manifest._json;
    let dirty = false;

    for (const row of fileRows) {
      const target = row.resolved?.target;
      if (!target) continue;
      const shouldWrite =
        ACTIONABLE.has(row.status) ||
        (row.status === "major-available" && flags.allowMajor) ||
        (row.status === "within-cooldown" && flags.allowFresh);
      if (!shouldWrite) continue;
      if (target === row.dep.spec) continue; // already pinned there

      if (manifest.kind === "package-json") {
        json[row.dep.bucket][row.dep.name] = target;
      } else {
        const arr = json[row.dep.bucket];
        const idx = arr.findIndex((e) => {
          const at = e.lastIndexOf("@");
          return (at > 0 ? e.slice(0, at) : e) === row.dep.name;
        });
        if (idx !== -1) arr[idx] = `${row.dep.name}@${target}`;
      }
      dirty = true;
      changed++;
      console.log(
        `${flags.dryRun ? "would update" : "updated"} ${relative(root, manifest.file)}: ` +
          `${row.dep.name} ${row.dep.spec || "(bare)"} → ${target}`,
      );
    }

    if (dirty && !flags.dryRun) {
      await writeFile(manifest.file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    }
  }

  console.log(
    `\n${flags.dryRun ? "dry run — " : ""}${changed} ${changed === 1 ? "dependency" : "dependencies"} ` +
      `${flags.dryRun ? "would be updated" : "updated"}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
