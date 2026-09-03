// Fail loud when two manifests that must agree on a dependency's exact version stop
// agreeing (issue #59).
//
// The case that forced this: `modules/email-react/files/package.json` pins `react` for
// the email renderer, and `packages/cli/templates/base/packages/ui/package.json` pins it
// for the design system. Both land in the SAME scaffolded project. Neither file is a
// pnpm workspace member of this repo, so `pnpm outdated` never sees them, and a
// scaffolded project installs two Reacts without a word — the second copy is dead
// bundle weight in the Worker, and any `react` identity check across the two silently
// fails. `update-deps.ts` already reports a split like this, but as an informational
// note across every manifest, which is the right shape for a bump report and the wrong
// shape for a gate.
//
// So this is a narrow, declarative rule table: named deps, named files, exit non-zero on
// a mismatch. Adding a rule is three lines; nothing here scans.
//
// Runs first in `pnpm deps:verify`, ahead of `play:init`, so the cheap check fails
// before the multi-minute playground build.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build
// step; `pnpm typecheck` checks it via tsconfig.scripts.json.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

/** One dependency that must carry the same exact version in every named manifest. */
export interface PinRule {
  /** The npm package name, as it appears as a key in a `package.json` section. */
  dep: string;
  /** Repo-relative POSIX paths. At least two, or the rule compares nothing. */
  files: readonly string[];
}

/** A `package.json` read off disk, kept beside the path it came from for the message. */
export interface PinnedManifest {
  file: string;
  json: Record<string, unknown>;
}

/**
 * The rules. Keep each one to a real coupling — two manifests whose versions land in one
 * installed project — rather than a general wish for tidiness. An unrelated version
 * split is not a defect and must not fail this gate.
 */
export const PIN_RULES: readonly PinRule[] = [
  {
    dep: "react",
    files: [
      "modules/email-react/files/package.json",
      "packages/cli/templates/base/packages/ui/package.json",
    ],
  },
];

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

/**
 * The version a manifest pins for `dep`, looked up across the three dependency sections
 * in that order, or `undefined` when it pins none. `dependencies` wins over
 * `devDependencies` because that is which one npm installs when both name the package.
 */
export function readPin(
  json: Record<string, unknown>,
  dep: string
): string | undefined {
  for (const section of SECTIONS) {
    const bucket = json[section];
    if (typeof bucket === "object" && bucket !== null) {
      const value = (bucket as Record<string, unknown>)[dep];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Compare one rule against the manifests already read for it. Returns `null` when every
 * manifest carries the same version, or a message naming every file and its version.
 * A manifest that pins nothing reads as `(absent)` and fails the rule: a rule whose
 * target has been renamed away must break loudly rather than pass vacuously.
 */
export function checkRule(
  rule: PinRule,
  manifests: readonly PinnedManifest[]
): string | null {
  const found = manifests.map((manifest) => ({
    file: manifest.file,
    version: readPin(manifest.json, rule.dep),
  }));
  const distinct = new Set(found.map((entry) => entry.version));
  if (distinct.size <= 1 && !distinct.has(undefined)) {
    return null;
  }
  const lines = found.map(
    (entry) => `    ${entry.file}: ${entry.version ?? "(absent)"}`
  );
  return `"${rule.dep}" is pinned inconsistently:\n${lines.join("\n")}`;
}

async function readManifest(
  root: string,
  file: string
): Promise<PinnedManifest> {
  const raw = await readFile(join(root, file), "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${file} is not a JSON object`);
  }
  return { file, json: parsed as Record<string, unknown> };
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const failures: string[] = [];

  for (const rule of PIN_RULES) {
    const manifests = await Promise.all(
      rule.files.map((file) => readManifest(root, file))
    );
    const failure = checkRule(rule, manifests);
    if (failure !== null) {
      failures.push(failure);
    }
  }

  if (failures.length > 0) {
    console.error("verify-pins: pinned versions disagree\n");
    for (const failure of failures) {
      console.error(`  ${failure}\n`);
    }
    console.error(
      "  Set both manifests to one version, or drop the rule from scripts/verify-pins.ts\n" +
        "  if the coupling is genuinely gone."
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `verify-pins: ${PIN_RULES.length} pin rule(s) agree across their manifests.`
  );
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
