import { isPublicVar } from "./env-example.js";

// The value half of `saasaloy env` (#50): what a declared variable is, whether it is
// already answered, and how an answer reaches the file that holds it.
//
// There is no routing left here, and that is the point of #153. Every declared value goes
// to one gitignored file, `packages/env/.env`, which is what `@repo/env`'s `local` value
// source reads and what `pnpm env:setup` distributes into each service's own `.env`.
// Which service reads a key is the descriptor's own `envServices` declaration, applied by
// `env-example.ts` when it writes the key list — never inferred from a manifest, a
// wrangler config or an alias, and never an `ambiguous` prompt.

/** The one file `saasaloy env` writes: the gitignored local value source. */
export const LOCAL_VALUES = "packages/env/.env";

export { ENV_EXAMPLE, isPublicVar, PUBLIC_PREFIX } from "./env-example.js";

/** One variable a module declares, carrying the description the prompt will read out. */
export interface Declaration {
  name: string;
  /** The declaring module's own wording — `env` never paraphrases it. */
  description: string;
  /** The module that declared it. */
  module: string;
  /** The local-dev value the descriptor supplies, if any. */
  devValue?: string;
}

/**
 * The `KEY=value` pairs a `.env` sets. Comments and blank lines are dropped; this answers
 * one question only, which is whether a key already has a value.
 */
export function parseEnvValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return values;
}

/**
 * Is this variable already answered? A key present with an empty value is a placeholder
 * someone left behind, not an answer, so `env` offers to fill it. Anything else is a
 * value a person typed, and `env` never rewrites one.
 */
export function isSet(values: Record<string, string>, name: string): boolean {
  return (values[name] ?? "").trim() !== "";
}

/**
 * Is this line the empty placeholder for `name` — `KEY=`, with nothing but spaces after
 * the `=`? A commented-out line is not one: `# KEY=` has a key of `# KEY`.
 */
function isPlaceholderFor(line: string, name: string): boolean {
  const equals = line.indexOf("=");
  return (
    equals !== -1 &&
    line.slice(0, equals).trim() === name &&
    line.slice(equals + 1).trim() === ""
  );
}

/**
 * The file's new content, with `additions` written in.
 *
 * Every existing line survives byte for byte, comments and ordering included. This is a
 * file a person edits by hand, unlike `packages/env/.env.example`, which is regenerated
 * from the descriptors — re-rendering it here would throw away their formatting to say
 * the same thing.
 *
 * One exception, and it is the reason this is not a plain append: a `.env` copied from
 * the example holds `KEY=` for every variable, and `isSet` calls those unset. Appending
 * would leave the file carrying two lines for one key, the first of them a lie. So a
 * placeholder is filled where it stands, and only a key the file has never heard of goes
 * on the end.
 */
export function appendVars(
  existing: string | undefined,
  additions: [string, string][]
): string {
  if (additions.length === 0) {
    return existing ?? "";
  }
  if (!existing || existing.trim() === "") {
    return `${additions.map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
  }

  const lines = existing.split("\n");
  const appended: string[] = [];
  for (const [name, value] of additions) {
    const line = `${name}=${value}`;
    const index = lines.findIndex((existingLine) =>
      isPlaceholderFor(existingLine, name)
    );
    if (index === -1) {
      appended.push(line);
    } else {
      lines[index] = line;
    }
  }

  const kept = lines.join("\n");
  const head = kept.endsWith("\n") ? kept : `${kept}\n`;
  return appended.length === 0 ? head : `${head}${appended.join("\n")}\n`;
}

/**
 * The production block: one `wrangler secret put` per secret.
 *
 * Printed, never run. Putting a secret into a live Cloudflare account is a deploy, and a
 * scaffolding tool that deploys on your behalf is a scaffolding tool you cannot trust
 * with a token. The lines are here to be copied.
 *
 * A `PUBLIC_` value is left out: it is inlined into a bundle at build time, so it is set
 * in the deploying service's `.env`, not in a secret store. The key list says which
 * service reads it.
 */
export function productionSecretCommands(names: string[]): string[] {
  const secrets = names.filter((name) => !isPublicVar(name)).toSorted();
  if (secrets.length === 0) {
    return [];
  }
  return [
    "# from the Worker's workspace, e.g. apps/api",
    ...secrets.map((name) => `wrangler secret put ${name}`),
  ];
}
