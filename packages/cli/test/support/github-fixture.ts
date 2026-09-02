import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tarGz } from "./tar.js";

// A local stand-in for the three GitHub endpoints `RemoteRegistrySource` calls, plus the
// tarball giget fetches. Hermetic on purpose (plan, 2026-09-01): the remote path is what
// every real user hits, and a gate that has to be trusted cannot depend on the network or
// on a rate limit somebody else is spending.
//
// The CLI reaches it through two env vars a caller points at `GithubFixture.url`:
// `SAASALOY_GITHUB_API` for the API calls the CLI makes itself, and `GIGET_GITHUB_URL`
// for the tarball, which giget builds as `${base}/repos/<owner>/<repo>/tarball/<ref>`.

/** One module's folder: file path relative to `modules/<name>/` → contents. */
export type ModuleFiles = Record<string, string>;

export interface GithubFixtureOptions {
  owner?: string;
  repo?: string;
  /** What `GET /repos/:owner/:repo` reports, and what an unpinned add resolves to. */
  defaultBranch?: string;
  /** The commit SHA every ref resolves to, unless `shaByRef` names another. */
  sha?: string;
  /** Per-ref SHAs, so a test can prove an explicit `@ref` took a different path. */
  shaByRef?: Record<string, string>;
  /** Module name → its folder's files. Serves both the tree listing and the tarball. */
  modules?: Record<string, ModuleFiles>;
  /**
   * Answer a request with a failure instead of the fixture. Called first for every
   * request; return `undefined` to let the normal handler run.
   */
  failure?: (path: string) => FixtureFailure | undefined;
}

export interface FixtureFailure {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface GithubFixture {
  /** Base URL both env vars point at, e.g. `http://127.0.0.1:41234`. */
  url: string;
  /** Every request path the fixture served, in order — how a test counts API calls. */
  requests: string[];
  close(): Promise<void>;
}

const DEFAULT_SHA = `${"0".repeat(39)}1`;

export async function startGithubFixture(
  options: GithubFixtureOptions = {}
): Promise<GithubFixture> {
  const owner = options.owner ?? "mimukit";
  const repo = options.repo ?? "saasaloy";
  const defaultBranch = options.defaultBranch ?? "main";
  const sha = options.sha ?? DEFAULT_SHA;
  const modules = options.modules ?? {};
  const requests: string[] = [];

  const shaFor = (ref: string): string => options.shaByRef?.[ref] ?? sha;

  const tarballFor = (ref: string): Buffer => {
    const prefix = `${owner}-${repo}-${shaFor(ref).slice(0, 7)}`;
    const files: Record<string, string> = {};
    for (const [name, moduleFiles] of Object.entries(modules)) {
      for (const [path, content] of Object.entries(moduleFiles)) {
        files[`${prefix}/modules/${name}/${path}`] = content;
      }
    }
    return tarGz(files);
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const path = req.url ?? "/";
    requests.push(path);

    const failure = options.failure?.(path);
    if (failure) {
      res.writeHead(failure.status, {
        "content-type": "application/json",
        ...failure.headers,
      });
      res.end(failure.body ?? JSON.stringify({ message: "fixture failure" }));
      return;
    }

    const repoPath = `/repos/${owner}/${repo}`;
    if (path === repoPath) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ default_branch: defaultBranch }));
      return;
    }

    const commit = new RegExp(`^${repoPath}/commits/([^/?]+)$`).exec(path);
    if (commit) {
      // The CLI asks with `Accept: application/vnd.github.sha`, which GitHub answers
      // with the bare SHA as text. Anything else would be the full commit JSON, and a
      // test that stopped sending the header should fail rather than pass by luck.
      if (req.headers.accept !== "application/vnd.github.sha") {
        res.writeHead(415, { "content-type": "text/plain" });
        res.end("fixture serves the SHA media type only");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${shaFor(decodeURIComponent(commit[1]!))}\n`);
      return;
    }

    if (path.startsWith(`${repoPath}/git/trees/`)) {
      const tree = Object.keys(modules).flatMap((name) =>
        Object.keys(modules[name] ?? {}).map((file) => ({
          path: `modules/${name}/${file}`,
        }))
      );
      // A file outside `modules/` and a nested folder both have to be ignored by the
      // caller's own filter, so the fixture always ships one of each.
      tree.push({ path: "README.md" }, { path: "modules/nested/deep/file.ts" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tree }));
      return;
    }

    const tarball = new RegExp(`^${repoPath}/tarball/([^/?]+)$`).exec(path);
    if (tarball) {
      const body = tarballFor(decodeURIComponent(tarball[1]!));
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address() as AddressInfo;

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        });
      });
    },
  };
}

/** A descriptor + one file, the smallest module a fixture registry can offer. */
export function fixtureModule(
  name: string,
  extra: Record<string, unknown> = {}
): ModuleFiles {
  return {
    "registry-item.json": JSON.stringify({
      name,
      type: "saasaloy:feature",
      files: [{ path: `files/${name}.ts`, target: `@web/${name}.ts` }],
      ...extra,
    }),
    [`files/${name}.ts`]: `export const ${name.replaceAll("-", "_")} = 1;\n`,
  };
}
