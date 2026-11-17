import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ModuleFiles } from "./github-fixture.js";

// A registry that is a real git repository, served through the GitHub endpoints the CLI
// calls (ADR 0062). `github-fixture.ts` maps every ref to one SHA, which cannot show that
// a tag and a later `main` hold different modules. This one answers from `git` itself:
// `commits/<ref>` peels the ref to its commit the way GitHub does for an annotated tag,
// the tree lists what that commit holds, and the tarball is `git archive` of it. The CLI
// reaches it through the same two env vars: `SAASALOY_GITHUB_API` for the API and
// `GIGET_GITHUB_URL` for the tarball.

export interface GitRegistry {
  /** The repository's working tree. */
  dir: string;
  /** Base URL both env vars point at. */
  url: string;
  /** Write each module's files under `modules/<name>/` and commit them on `main`. */
  commit(message: string, modules: Record<string, ModuleFiles>): string;
  /** An annotated tag on the current `main` commit, as release-it writes one. */
  tag(name: string): void;
  /** The commit a ref names, peeled. */
  revParse(ref: string): string;
  close(): Promise<void>;
}

const GIT_ENV = {
  GIT_AUTHOR_EMAIL: "registry@example.test",
  GIT_AUTHOR_NAME: "registry",
  GIT_COMMITTER_EMAIL: "registry@example.test",
  GIT_COMMITTER_NAME: "registry",
};

export async function startGitRegistry(
  owner = "mimukit",
  repo = "saasaloy"
): Promise<GitRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "saasaloy-git-registry-"));
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, ...GIT_ENV },
    }).trim();
  const gitBytes = (args: string[]): Buffer =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, ...GIT_ENV },
    });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "tag.gpgsign", "false"]);

  /** The commit SHA a ref names, or undefined when git does not know it. */
  const peel = (ref: string): string | undefined => {
    try {
      return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    } catch {
      return undefined;
    }
  };

  const repoPath = `/repos/${owner}/${repo}`;
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const path = url.pathname;
    const notFound = (): void => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
    };

    if (path === repoPath) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ default_branch: "main" }));
      return;
    }
    const commit = new RegExp(`^${repoPath}/commits/([^/]+)$`).exec(path);
    if (commit?.[1]) {
      const ref = decodeURIComponent(commit[1]);
      const sha = peel(ref);
      if (!sha) {
        // GitHub answers a missing ref on this endpoint with 422, not 404.
        res.writeHead(422, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message: `No commit found for SHA: ${ref}`,
            status: "422",
          })
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${sha}\n`);
      return;
    }
    const tree = new RegExp(`^${repoPath}/git/trees/([^/]+)$`).exec(path);
    if (tree?.[1]) {
      const sha = peel(decodeURIComponent(tree[1]));
      if (!sha) {
        notFound();
        return;
      }
      const paths = git(["ls-tree", "-r", "--name-only", sha])
        .split("\n")
        .filter(Boolean);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tree: paths.map((p) => ({ path: p })) }));
      return;
    }
    const tarball = new RegExp(`^${repoPath}/tarball/([^/]+)$`).exec(path);
    if (tarball?.[1]) {
      const sha = peel(decodeURIComponent(tarball[1]));
      if (!sha) {
        notFound();
        return;
      }
      // GitHub prefixes every entry with `<owner>-<repo>-<sha7>/`; giget strips it.
      const body = gitBytes([
        "archive",
        "--format=tar.gz",
        `--prefix=${owner}-${repo}-${sha.slice(0, 7)}/`,
        sha,
      ]);
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(body);
      return;
    }
    notFound();
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address() as AddressInfo;

  return {
    dir,
    url: `http://127.0.0.1:${address.port}`,
    commit(message, modules) {
      for (const [name, files] of Object.entries(modules)) {
        for (const [file, content] of Object.entries(files)) {
          const target = join(dir, "modules", name, file);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, content, "utf-8");
        }
      }
      git(["add", "--all"]);
      git(["commit", "--quiet", "--message", message]);
      return git(["rev-parse", "HEAD"]);
    },
    tag(name) {
      git(["tag", "--annotate", "--message", `Release ${name}`, name]);
    },
    revParse(ref) {
      const sha = peel(ref);
      if (!sha) {
        throw new Error(`git registry fixture has no ref ${ref}`);
      }
      return sha;
    },
    async close() {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
      await rm(dir, { force: true, recursive: true });
    },
  };
}
