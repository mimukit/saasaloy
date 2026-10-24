import { RefusalError } from "./exit.js";
import type { Manifest } from "./manifest.js";
import type { SaasaloyConfig } from "./schema.js";

// A project's testing mode (#242, ADR 0053). The value lives in `saasaloy.json` under
// `testing.mode`; the root `AGENTS.md` carries a marked block that tells an agent what
// the mode asks of it. The CLI writes both together, and it rewrites only the text
// between the markers, so everything an owner wrote around the block survives.
//
// The texts live here rather than in the template so `init`, `update` and
// `saasaloy testing` fill the block from one source. The template ships the `off` text
// between its markers, and a test holds the two equal.

export const TESTING_MODES = ["off", "tests-after", "tdd"] as const;

export type TestingMode = (typeof TESTING_MODES)[number];

/** The mode an absent `testing` key reads as: testing is opt-in. */
export const DEFAULT_TESTING_MODE: TestingMode = "off";

/** The file the block lives in, project-relative. Only the root one is rewritten. */
export const TESTING_BLOCK_FILE = "AGENTS.md";

export const TESTING_BLOCK_START = "<!-- saasaloy:testing -->";
export const TESTING_BLOCK_END = "<!-- /saasaloy:testing -->";

export function isTestingMode(value: string): value is TestingMode {
  return (TESTING_MODES as readonly string[]).includes(value);
}

/** The mode `value` names. A value outside the three is a refusal (exit 2), never a guess. */
export function parseTestingMode(value: string): TestingMode {
  if (!isTestingMode(value)) {
    throw new RefusalError(
      `Unknown testing mode "${value}". Use one of: ${TESTING_MODES.join(", ")}.`
    );
  }
  return value;
}

/** The project's mode. A project scaffolded before the key existed reads as `off`. */
export function readTestingMode(config: SaasaloyConfig): TestingMode {
  return config.testing?.mode ?? DEFAULT_TESTING_MODE;
}

// One text per mode, in the template AGENTS.md's own register: short, imperative, and
// naming the command or the skill to reach for.
export const TESTING_BLOCKS: Record<TestingMode, string> = {
  off: [
    "Testing mode: `off`. This project ships no module tests, and `saasaloy add` writes none. Do not add tests unless the owner asks for them.",
    "",
    "- Turn module tests on with `saasaloy testing tests-after`, or `saasaloy testing tdd` to work test-first.",
  ].join("\n"),
  "tests-after": [
    "Testing mode: `tests-after`. Every change ships with its test, written once the code works.",
    "",
    "- Read the `saasaloy-testing` skill to find which test a change needs, and copy the example it names.",
    "- Run `pnpm test` before you hand the change over. It must pass.",
  ].join("\n"),
  tdd: [
    "Testing mode: `tdd`. Write the test first, one behaviour at a time:",
    "",
    "1. Write the failing test. The `saasaloy-testing` skill says which test a change needs.",
    "2. Run it, and see it fail for the reason you stated.",
    "3. Write the code.",
    "4. Run the test again, and see it pass.",
    "",
    "Write no code that a failing test did not ask for. Run `pnpm test` before you hand the change over.",
  ].join("\n"),
};

export type BlockRewrite = { found: true; content: string } | { found: false };

/**
 * `content` with the text between the testing markers replaced by `mode`'s text. Pure:
 * the caller reads and writes the file. Missing markers, or an end marker before the
 * start, come back as `{ found: false }` rather than a throw, because an owner who
 * deleted the block still gets the mode saved and a warning (#242).
 */
export function rewriteTestingBlock(
  content: string,
  mode: TestingMode
): BlockRewrite {
  const start = content.indexOf(TESTING_BLOCK_START);
  if (start === -1) {
    return { found: false };
  }
  const inner = start + TESTING_BLOCK_START.length;
  const end = content.indexOf(TESTING_BLOCK_END, inner);
  if (end === -1) {
    return { found: false };
  }
  return {
    found: true,
    content: `${content.slice(0, inner)}\n${TESTING_BLOCKS[mode]}\n${content.slice(end)}`,
  };
}

/**
 * Whether `update` prints the one-line hint to pick a mode (#242). A project made before
 * the key existed may already hold module tests (`auth.test.ts` shipped unconditionally),
 * and reading it as `off` would leave the owner unaware the switch exists. The base's own
 * tests do not count: they ship in every mode. A project with the key, at any value, has
 * already chosen.
 */
export function suggestsTestingMode(
  config: SaasaloyConfig,
  manifest: Pick<Manifest, "managed">
): boolean {
  if (config.testing !== undefined) {
    return false;
  }
  return Object.entries(manifest.managed).some(
    // `BASE_MODULE`, spelled out: importing it from `base.ts` would close a cycle
    // (`base.ts` → `scaffold.ts` → this file).
    ([target, entry]) => entry.module !== "base" && target.endsWith(".test.ts")
  );
}
