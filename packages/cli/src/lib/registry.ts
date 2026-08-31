import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { downloadTemplate } from "giget";
import { RefusalError } from "./exit.js";
import { pathExists, readDirNames } from "./fs-utils.js";
import type { RegistryItem } from "./schema.js";
import { validateRegistryItem } from "./schema.js";

// A module registry is a GitHub repo whose `modules/<name>/` folders each hold one
// module's `registry-item.json` descriptor plus the files it drops in (build spec §2.4,
// ADR 0012 — remote-first, the repo *is* the registry). `saasaloy add` resolves a ref to
// a commit SHA and fetches the module subtree at that SHA; the resolved SHA is written to
// `saasaloy-lock.json` for reproducibility. A local checkout (SAASALOY_REGISTRY_DIR) is a
// dev/offline override. This module is the single seam that knows *where* descriptors live.

// Point the applier at a local `modules/` checkout instead of fetching — for developing
// modules and for offline/CI runs against fixtures.
export const REGISTRY_ENV = "SAASALOY_REGISTRY_DIR";

// Where a bare `saasaloy add <name>` resolves: the CLI's own repo is the first-party
// registry. An explicit `owner/repo/name` coordinate overrides it.
export const DEFAULT_OWNER = "mimukit";
export const DEFAULT_REPO = "saasaloy";

export interface LoadedModule {
  /** Absolute path to a local copy of the module's folder (source of `files[].path`). */
  dir: string;
  item: RegistryItem;
}

/** Where a module was resolved from — the lockfile entry, minus `dependsOn`. */
export interface ModuleProvenance {
  /** `owner/repo` for a remote source, or `local` for a SAASALOY_REGISTRY_DIR checkout. */
  source: string;
  /** The ref requested (branch/tag/SHA), or `local`. */
  ref: string;
  /** The exact commit SHA resolved, or `local` — the integrity anchor. */
  resolved: string;
}

/** The seam that knows *where* descriptors live. Remote (default) or local (override). */
export interface RegistrySource {
  /** Human label for messages (e.g. `mimukit/saasaloy@main` or a local path). */
  readonly label: string;
  /** Read + validate one module descriptor by name; `dir` is a local copy of its folder. */
  readModule(name: string, requiredBy?: string): Promise<LoadedModule>;
  /** Names of the modules this source offers — powers the interactive picker. */
  listModules(): Promise<string[]>;
  /** Provenance for the lockfile (source + ref + resolved SHA). */
  provenance(): ModuleProvenance;
  /**
   * The commit SHA this source's ref currently points at (`local` for a local
   * checkout). `saasaloy update` compares it against the lock's `resolved` to decide
   * whether anything moved — the same resolution path `readModule` pins to, exposed.
   */
  resolveSha(): Promise<string>;
  /**
   * Subjects of the commits touching `modulePath` between two SHAs, oldest first —
   * the natural-language "intent" half of the merge plan (issue #48, decision 4).
   * Best-effort: returns `[]` rather than throwing when the history isn't reachable
   * (force-push, deleted tag, rate limit, local source), so a merge plan degrades to
   * diff-only instead of failing.
   */
  commitSubjects(
    modulePath: string,
    baseSha: string,
    headSha: string
  ): Promise<string[]>;
  /** Drop any temp working dirs created while fetching. No-op for a local source. */
  cleanup?(): Promise<void>;
}

// --- Module coordinate parsing ---------------------------------------------------

export interface Coordinate {
  owner?: string;
  repo?: string;
  /** Branch/tag/SHA; undefined means the repo's default branch. */
  ref?: string;
  /** The module to add; undefined means "show a picker". */
  module?: string;
}

// Grammar (build spec §3, ADR 0012):
//   waitlist                → default repo, module `waitlist`
//   owner/repo/waitlist     → third-party repo, module `waitlist`
//   owner/repo@ref/waitlist → pinned ref
//   owner/repo              → no module ⇒ picker over that repo
//   (nothing)               → picker over the default repo
// A ref carrying a `/` (e.g. a `feature/x` branch) isn't addressable in v1 — pin such a
// branch's tip SHA instead, or rely on the default branch. Pinning a ref on the *default*
// repo (`waitlist@v2`) is likewise unsupported: a ref requires an explicit `owner/repo`.
export function parseCoordinate(input?: string): Coordinate {
  if (!input) {
    return {};
  }

  let ref: string | undefined;
  let rest = input;
  const at = input.indexOf("@");
  if (at !== -1) {
    const afterAt = input.slice(at + 1);
    const slash = afterAt.indexOf("/");
    ref = slash === -1 ? afterAt : afterAt.slice(0, slash);
    const beforeAt = input.slice(0, at);
    const afterRef = slash === -1 ? "" : afterAt.slice(slash + 1);
    rest = afterRef ? `${beforeAt}/${afterRef}` : beforeAt;
    if (!ref) {
      throw new RefusalError(
        `Malformed coordinate "${input}" — empty ref after "@".`
      );
    }
  }

  const segs = rest.split("/").filter(Boolean);

  if (ref === undefined && segs.length === 1) {
    return { module: segs[0] };
  }
  if (segs.length === 2) {
    return { owner: segs[0], repo: segs[1], ref };
  }
  if (segs.length === 3) {
    return { owner: segs[0], repo: segs[1], ref, module: segs[2] };
  }

  throw new RefusalError(
    `Malformed coordinate "${input}" — expected "name", "owner/repo", or "owner/repo[@ref]/name".`
  );
}

/** Build the source a coordinate resolves against: local override if set, else remote. */
export function createRegistrySource(coord: Coordinate): RegistrySource {
  const override = process.env[REGISTRY_ENV];
  if (override) {
    const dir = isAbsolute(override)
      ? override
      : resolve(process.cwd(), override);
    return new LocalRegistrySource(dir);
  }
  return new RemoteRegistrySource(
    coord.owner ?? DEFAULT_OWNER,
    coord.repo ?? DEFAULT_REPO,
    coord.ref
  );
}

// --- Shared descriptor loading ---------------------------------------------------

/** Read + validate `<dir>/registry-item.json`, asserting it declares `name`. */
export async function loadModuleFolder(
  dir: string,
  name: string,
  requiredBy?: string
): Promise<LoadedModule> {
  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    const because = requiredBy ? ` (required by ${requiredBy})` : "";
    throw new Error(
      `Unknown module "${name}"${because} — no ${name}/registry-item.json in the registry.`
    );
  }
  const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
  const result = await validateRegistryItem(parsed);
  if (!result.valid) {
    throw new Error(
      `Module "${name}" has an invalid descriptor:\n  ${result.errors.join("\n  ")}`
    );
  }
  const item = parsed as RegistryItem;
  if (item.name !== name) {
    throw new Error(
      `Module folder "${name}" declares name "${item.name}" — the folder and descriptor name must match.`
    );
  }
  return { dir, item };
}

// --- Local source (SAASALOY_REGISTRY_DIR) ---------------------------------------

/** A local `modules/` directory: `<dir>/<name>/registry-item.json`. Dev/offline. */
export class LocalRegistrySource implements RegistrySource {
  constructor(private readonly dir: string) {}

  get label(): string {
    return this.dir;
  }

  async readModule(name: string, requiredBy?: string): Promise<LoadedModule> {
    await this.assertExists();
    return loadModuleFolder(join(this.dir, name), name, requiredBy);
  }

  async listModules(): Promise<string[]> {
    await this.assertExists();
    const names: string[] = [];
    for (const name of await readDirNames(this.dir)) {
      if (await pathExists(join(this.dir, name, "registry-item.json"))) {
        names.push(name);
      }
    }
    return names.toSorted();
  }

  provenance(): ModuleProvenance {
    return { ref: "local", resolved: "local", source: "local" };
  }

  // A working copy has no commit identity and no history to read — `update` treats
  // both as "no merge base, no intent" and degrades the merge plan accordingly.
  async resolveSha(): Promise<string> {
    return "local";
  }

  async commitSubjects(
    _modulePath: string,
    _baseSha: string,
    _headSha: string
  ): Promise<string[]> {
    return [];
  }

  private async assertExists(): Promise<void> {
    if (!(await pathExists(this.dir))) {
      throw new Error(`${REGISTRY_ENV}=${this.dir} does not exist.`);
    }
  }
}

// --- Remote source (GitHub, default) --------------------------------------------

const GITHUB_API = "https://api.github.com";

// Every GitHub call gets one. Without it a connection that opens and then stalls — a
// captive portal, a half-dead proxy — hangs `saasaloy add` with no output and no way
// out but Ctrl-C (#98). Fifteen seconds is far above a healthy round trip and far below
// a person's patience. No retry: a failure here is reported with the offline escape
// hatch below, which is faster than waiting through a second attempt.
const FETCH_TIMEOUT_MS = 15_000;

/** The line every network failure ends with, so the offline path is never a secret. */
export const OFFLINE_HINT = `Set ${REGISTRY_ENV} to a local \`modules/\` checkout to work offline.`;

// GITHUB_TOKEN (or GIGET_AUTH) lifts the 60→5000 req/hr limit and unlocks private repos.
// Read at call time so tests and long-lived processes can set it after import.
function authToken(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.GIGET_AUTH;
}

interface TreeEntry {
  path: string;
}

interface CommitEntry {
  sha: string;
  commit: { message: string };
}

/** First line of a commit message — this repo's Conventional Commits read as a changelog. */
function subjectOf(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

/** A GitHub repo fetched via giget; descriptors + files pulled at a pinned commit SHA. */
export class RemoteRegistrySource implements RegistrySource {
  private resolved?: { ref: string; sha: string };
  private readonly tempDirs: string[] = [];

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly ref?: string
  ) {}

  get label(): string {
    return `${this.owner}/${this.repo}${this.ref ? `@${this.ref}` : ""}`;
  }

  async readModule(name: string, requiredBy?: string): Promise<LoadedModule> {
    const { sha } = await this.resolve();
    const parent = await mkdtemp(join(tmpdir(), "saasaloy-reg-"));
    this.tempDirs.push(parent);
    const dir = join(parent, name);
    try {
      await downloadTemplate(
        `github:${this.owner}/${this.repo}/modules/${name}#${sha}`,
        {
          auth: authToken(),
          dir,
          force: true,
        }
      );
    } catch (error) {
      const because = requiredBy ? ` (required by ${requiredBy})` : "";
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not fetch module "${name}"${because} from ${this.owner}/${this.repo} — ${detail}. ${OFFLINE_HINT}`,
        { cause: error }
      );
    }
    return loadModuleFolder(dir, name, requiredBy);
  }

  async listModules(): Promise<string[]> {
    const { sha } = await this.resolve();
    const tree = await this.api<{ tree?: TreeEntry[] }>(
      `/repos/${this.owner}/${this.repo}/git/trees/${sha}?recursive=1`
    );
    const names: string[] = [];
    for (const entry of tree.tree ?? []) {
      const name = /^modules\/([a-z0-9][a-z0-9-]*)\/registry-item\.json$/.exec(
        entry.path
      )?.[1];
      if (name) {
        names.push(name);
      }
    }
    return names.toSorted();
  }

  provenance(): ModuleProvenance {
    if (!this.resolved) {
      throw new Error(
        "provenance() called before the source resolved a commit SHA."
      );
    }
    return {
      ref: this.resolved.ref,
      resolved: this.resolved.sha,
      source: `${this.owner}/${this.repo}`,
    };
  }

  async resolveSha(): Promise<string> {
    return (await this.resolve()).sha;
  }

  // GitHub has no "commits touching this path between A and B" endpoint, so intersect
  // two queries: `compare` gives the commits between the SHAs, `commits?path=` gives
  // the ones touching the module. Both are reported best-effort — the merge plan is
  // still useful without intent, and an update must never fail over a changelog.
  async commitSubjects(
    modulePath: string,
    baseSha: string,
    headSha: string
  ): Promise<string[]> {
    if (baseSha === headSha) {
      return [];
    }
    try {
      const between = await this.api<{ commits?: CommitEntry[] }>(
        `/repos/${this.owner}/${this.repo}/compare/${baseSha}...${headSha}`
      );
      const touching = await this.api<CommitEntry[]>(
        `/repos/${this.owner}/${this.repo}/commits?sha=${headSha}&path=${encodeURIComponent(modulePath)}&per_page=100`
      );
      const touchingShas = new Set(touching.map((c) => c.sha));
      return (between.commits ?? [])
        .filter((c) => touchingShas.has(c.sha))
        .map((c) => subjectOf(c.commit.message))
        .filter((subject) => subject.length > 0);
    } catch {
      return [];
    }
  }

  async cleanup(): Promise<void> {
    await Promise.all(
      this.tempDirs.map((dir) => rm(dir, { force: true, recursive: true }))
    );
    this.tempDirs.length = 0;
  }

  // Resolve the requested ref (or the repo's default branch) to a concrete commit SHA,
  // once per source — every module in one install pins to the same SHA.
  private async resolve(): Promise<{ ref: string; sha: string }> {
    if (this.resolved) {
      return this.resolved;
    }
    const ref =
      this.ref ??
      (
        await this.api<{ default_branch: string }>(
          `/repos/${this.owner}/${this.repo}`
        )
      ).default_branch;
    const sha = (
      await this.apiText(
        `/repos/${this.owner}/${this.repo}/commits/${ref}`,
        "application/vnd.github.sha"
      )
    ).trim();
    this.resolved = { ref, sha };
    return this.resolved;
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "saasaloy-cli",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const auth = authToken();
    if (auth) {
      headers.Authorization = `Bearer ${auth}`;
    }
    return headers;
  }

  private async api<T>(path: string): Promise<T> {
    return JSON.parse(
      await this.apiText(path, "application/vnd.github+json")
    ) as T;
  }

  private async apiText(path: string, accept: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}${path}`, {
        headers: this.headers(accept),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout arrives as a TimeoutError and everything else (DNS, TLS, refused
      // connection) as a TypeError; both read the same to a user, and both are worth
      // pointing at the offline path. The original is kept as `cause` so
      // SAASALOY_DEBUG can print it.
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(
        `Could not reach GitHub for ${this.owner}/${this.repo} (${path})` +
          `${timedOut ? ` — no response in ${FETCH_TIMEOUT_MS / 1000}s` : ""}. ${OFFLINE_HINT}`,
        { cause: error }
      );
    }
    if (!res.ok) {
      if (
        res.status === 403 &&
        res.headers.get("x-ratelimit-remaining") === "0"
      ) {
        throw new Error(
          `GitHub API rate limit hit for ${this.owner}/${this.repo}. Set GITHUB_TOKEN to raise it. ${OFFLINE_HINT}`
        );
      }
      if (res.status === 404) {
        throw new RefusalError(
          `Not found on GitHub: ${this.owner}/${this.repo} (${path}). ${OFFLINE_HINT}`
        );
      }
      throw new Error(
        `GitHub API error ${res.status} for ${this.owner}/${this.repo} (${path}). ${OFFLINE_HINT}`
      );
    }
    return res.text();
  }
}
