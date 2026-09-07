// The version-selection policy behind `pnpm deps:update` / `deps:check` (ADR 0016),
// separated from the command so the rules can be tested with fixed inputs. Everything
// here is pure: no network, no clock, no flags. `update-deps.ts` fetches the packument,
// reads the cooldown from pnpm-workspace.yaml, supplies `Date.now()` and the parsed CLI
// flags, and renders whatever this module decides.
//
// Policy, per package: enumerate the npm `versions` map, DROP prereleases, IGNORE
// dist-tags (never trust `latest`), cap at the highest eligible version WITHIN the
// current major, and require the publish time to clear the cooldown. A newer major is
// surfaced as `major-available` and offered as its own candidate; the command decides
// whether that candidate is applied (--allow-major / the picker). The cooldown is lifted
// only by `allowFresh`.

// --- Input types -------------------------------------------------------------

/** The slice of an npm packument the resolver uses, normalized at the fetch boundary. */
export interface Packument {
  /** version → ISO publish time. Empty when the registry omits it. */
  time: Record<string, string>;
  /** The published `versions` map; only its keys are read. */
  versions: Record<string, unknown>;
}

/** How a version spec is written, which drives its status and what a write produces. */
export type SpecKind = "bare" | "exact" | "range";

/** The part of a dependency the policy reads: the spec as written and its kind. */
export interface VersionSpec {
  spec: string;
  kind: SpecKind;
}

/** Everything the policy needs beyond the dep and its packument. */
export interface PolicyOptions {
  /** The evaluation instant, in ms since the epoch. The command passes `Date.now()`. */
  nowMs: number;
  /** `minimumReleaseAge` from pnpm-workspace.yaml, in minutes. 0 disables the cooldown. */
  minimumReleaseAgeMinutes: number;
  /** `--allow-fresh`: treat every stable version as clear of the cooldown. */
  allowFresh: boolean;
}

// --- Result types ------------------------------------------------------------

/** What deps:update could pin for one dep, plus the context the report needs. */
export interface Resolved {
  /** Highest cooldown-eligible version within the current major: the safe default. */
  target: string | null;
  /** Highest cooldown-eligible version across ALL majors: what a major bump writes. */
  targetOverall: string | null;
  highestWithinMajor: string | null;
  highestOverall: string | null;
  newerMajor: boolean;
}

export type Status =
  | "up-to-date"
  | "outdated"
  | "range→exact"
  | "bare→pinned"
  | "major-available"
  | "within-cooldown"
  | "unresolved";

/** The statuses a default `deps:update` writes and `deps:check` exits 1 on. */
export const ACTIONABLE: ReadonlySet<Status> = new Set<Status>([
  "outdated",
  "range→exact",
  "bare→pinned",
]);

export type CandidateKind = "primary" | "major";

/** One version the policy is willing to write. */
export interface PolicyCandidate {
  kind: CandidateKind;
  target: string;
}

/** The complete decision for one (dep, packument) pair. */
export interface Evaluation {
  resolved: Resolved;
  status: Status;
  /**
   * At most one `primary` and one `major` candidate. `primary` is present only when the
   * status is actionable and the target differs from the current spec; `major` only when a
   * cooldown-eligible version exists in a newer major.
   */
  candidates: PolicyCandidate[];
}

// --- Version-spec classification ---------------------------------------------
// A spec's "kind" drives its status and what deps:update writes:
//   exact  — "5.14.1"        → already pinned; bump only if a newer eligible exists
//   range  — "^5", "~4.1"    → migrate to exact (range→exact)
//   bare   — "" (no version) → pin it (bare→pinned); only descriptor arrays can be bare
const EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function classifySpec(spec: string): SpecKind {
  if (spec === "" || spec === "latest" || spec === "*") {
    return "bare";
  }
  if (EXACT_RE.test(spec)) {
    return "exact";
  }
  return "range";
}

/** Leading major number of a spec, or null when there's nothing to anchor to (bare). */
export function specMajor(spec: string): number | null {
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

/** A stable version as a numeric triple. */
export type Semver = [number, number, number];

export function parseSemver(v: string): Semver | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// A version that is not a stable triple sorts BELOW every version that is, so a real
// release always reads as newer than an unparseable pin rather than comparing as equal.
export function cmp(a: string, b: string): number {
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
export function isUnorderableExact(dep: VersionSpec): boolean {
  return dep.kind === "exact" && parseSemver(dep.spec) === null;
}

// --- Resolution --------------------------------------------------------------

/**
 * Pick the versions the policy could write for one packument. `target` is the
 * within-major pin (the safe default, independent of any flag); `targetOverall` is the
 * highest cooldown-eligible version across ALL majors — what a deliberate major bump
 * would write.
 */
export function resolveVersions(
  curMajor: number | null,
  doc: Packument,
  options: PolicyOptions
): Resolved {
  const times = doc.time;
  const cooldownMs = options.minimumReleaseAgeMinutes * 60 * 1000;

  const stable = Object.keys(doc.versions).filter(
    (v) => parseSemver(v) !== null
  );
  stable.sort(cmp);

  // A version with no publish time, or an unparseable one, never clears the cooldown:
  // the registry gave nothing to measure against, and "unknown" must not read as "old".
  const clearsCooldown = (v: string): boolean => {
    if (options.allowFresh) {
      return true;
    }
    const t = times[v];
    if (!t) {
      return false;
    }
    const published = Date.parse(t);
    return !Number.isNaN(published) && options.nowMs - published >= cooldownMs;
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

// --- Status decision ---------------------------------------------------------

export function decideStatus(dep: VersionSpec, r: Resolved): Status {
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

// --- Candidates --------------------------------------------------------------

export function buildCandidates(
  dep: VersionSpec,
  r: Resolved,
  status: Status
): PolicyCandidate[] {
  // Nothing is ever written over an unorderable exact pin — not even the opt-in major
  // arm below, which would otherwise cross a major on a spec we cannot compare.
  if (isUnorderableExact(dep)) {
    return [];
  }
  const out: PolicyCandidate[] = [];
  const cur = dep.spec;
  if (ACTIONABLE.has(status) && r.target && r.target !== cur) {
    out.push({ kind: "primary", target: r.target });
  }
  if (r.newerMajor && r.targetOverall) {
    const mo = parseSemver(r.targetOverall);
    const cm = specMajor(cur);
    if (mo && cm !== null && mo[0] > cm && r.targetOverall !== cur) {
      out.push({ kind: "major", target: r.targetOverall });
    }
  }
  return out;
}

// --- The one entry point -----------------------------------------------------

/**
 * The complete policy decision for one dependency: which versions resolve, what status
 * the report shows, and which writes are on offer. Pure — the caller supplies the
 * packument, the clock, and the flags.
 */
export function evaluateDependency(
  dep: VersionSpec,
  packument: Packument,
  options: PolicyOptions
): Evaluation {
  const resolved = resolveVersions(specMajor(dep.spec), packument, options);
  const status = decideStatus(dep, resolved);
  return {
    candidates: buildCandidates(dep, resolved, status),
    resolved,
    status,
  };
}
