import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathExists } from "./fs-utils.js";

// Does git ignore this path? `saasaloy env` writes real secrets into `.dev.vars` and
// `.env`, so it has to prove the file will not be committed before it writes a single
// byte (#50). The base template's `_gitignore` already carves both out, but a project is
// a person's to edit, and an `env` that wrote a live API key into a tracked file would be
// the worst bug this CLI could ship.
//
// The check is done here, in process, rather than by shelling out to `git check-ignore`.
// `env`'s whole contract is that it prints deployment commands and never runs anything,
// and that promise is only checkable if the command path starts no child process at all. So this
// file implements the subset of gitignore's pattern language the question needs:
// comments, negation, anchoring, directory-only patterns, `*`, `?`, and `**`.
//
// Four deliberate gaps, none of which changes the answer for an env file: character
// classes (`[a-z]`) are matched literally, a backslash escape (`\#.env`, a trailing
// `.env\ `) is matched literally rather than unescaped, `.git/info/exclude` and the
// global excludes file are not read, and a `.gitignore` inside an already-ignored
// directory is still read. Each can only make the check stricter (report "not ignored"
// for something git would ignore), which refuses rather than leaks.

interface Rule {
  /** Tested against the path relative to the `.gitignore`'s own directory. */
  test: RegExp;
  /** A leading `!` — re-includes what an earlier rule excluded. */
  negated: boolean;
  /** A trailing `/` — matches a directory and never a file. */
  dirOnly: boolean;
}

interface Layer {
  /** Project-relative POSIX directory the `.gitignore` sits in; `""` at the root. */
  base: string;
  rules: Rule[];
}

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/** Translate a gitignore glob body into a regex source, `/` never matched by `*`. */
function globToRegex(glob: string): string {
  let out = "";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      // `**/` crosses directory boundaries; a bare `**` matches the rest of the path.
      index += 2;
      if (glob[index] === "/") {
        index += 1;
        out += "(?:.*/)?";
      } else {
        out += ".*";
      }
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(REGEX_SPECIAL, "\\$&");
    }
    index += 1;
  }
  return out;
}

/**
 * One `.gitignore` line as a rule, or undefined for a blank line or a comment.
 *
 * Exported for the tests: the anchoring rule (a pattern with an interior `/` is relative
 * to the `.gitignore`, one without matches a basename at any depth) is the part most
 * likely to be got wrong, and it is worth pinning directly.
 */
export function compilePattern(pattern: string): Rule | undefined {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }
  const negated = trimmed.startsWith("!");
  let body = negated ? trimmed.slice(1) : trimmed;
  const dirOnly = body.endsWith("/");
  if (dirOnly) {
    body = body.slice(0, -1);
  }
  if (!body) {
    return undefined;
  }
  // A `/` anywhere but the very end anchors the pattern to this `.gitignore`'s directory.
  const anchored = body.includes("/");
  if (body.startsWith("/")) {
    body = body.slice(1);
  }
  const prefix = anchored ? "" : "(?:.*/)?";
  return {
    dirOnly,
    negated,
    test: new RegExp(`^${prefix}${globToRegex(body)}$`),
  };
}

export function parseGitignore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split("\n")) {
    const rule = compilePattern(line);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * Whether the layers exclude one path. Shallow `.gitignore`s are applied before deep
 * ones and, within a file, the last matching line wins — git's own precedence, which is
 * what makes `!.env.example` after `.env.*` mean anything.
 */
function excludes(layers: Layer[], candidate: string, isDir: boolean): boolean {
  let ignored = false;
  for (const layer of layers) {
    if (layer.base && !candidate.startsWith(`${layer.base}/`)) {
      continue;
    }
    const rel = layer.base ? candidate.slice(layer.base.length + 1) : candidate;
    for (const rule of layer.rules) {
      if (rule.dirOnly && !isDir) {
        continue;
      }
      if (rule.test.test(rel)) {
        ignored = !rule.negated;
      }
    }
  }
  return ignored;
}

/**
 * The repository the project sits in, or undefined when it sits in none.
 *
 * The `.git` marker is not always at the project root. `saasaloy init .` inside an
 * existing repository deliberately does not nest a second one, and the CLI's own
 * `.dev/playground` is exactly that shape — so anchoring at the project root would report
 * every file as unignored and refuse every write.
 */
export async function findRepoRoot(start: string): Promise<string | undefined> {
  let current = resolve(start);
  for (;;) {
    if (await pathExists(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Would git ignore `relPosixPath` (project-relative, need not exist yet)?
 *
 * A path under no repository at all answers false. That is the conservative reading:
 * `env` uses this to decide whether writing a secret is safe, and "there is no repository
 * here yet" is not proof that the file will stay out of one. Refusing says so; a person
 * who wants the file anyway can `git init` or write it by hand.
 */
export async function isPathIgnored(
  root: string,
  relPosixPath: string
): Promise<boolean> {
  const repoRoot = await findRepoRoot(root);
  if (!repoRoot) {
    return false;
  }
  // Everything below is measured from the repository root, so a `.gitignore` above the
  // project is applied — and a project inside an already-ignored directory answers yes,
  // which is what git itself says.
  const fromRepo = relative(
    repoRoot,
    join(resolve(root), ...relPosixPath.split("/"))
  );
  const segments = fromRepo.split(sep).filter(Boolean);
  if (segments.length === 0 || segments.includes("..")) {
    return false;
  }

  const layers: Layer[] = [];
  for (let depth = 0; depth < segments.length; depth += 1) {
    const parts = segments.slice(0, depth);
    const file = join(repoRoot, ...parts, ".gitignore");
    if (await pathExists(file)) {
      layers.push({
        base: parts.join("/"),
        rules: parseGitignore(await readFile(file, "utf-8")),
      });
    }
  }

  // Top down: git cannot re-include a path inside an excluded directory, so the first
  // ancestor that matches settles it for everything below.
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const candidate = segments.slice(0, depth).join("/");
    if (excludes(layers, candidate, depth < segments.length)) {
      return true;
    }
  }
  return false;
}
