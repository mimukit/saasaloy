// The repo paths outside apps/web that the site build reads, split by where a site deploy
// takes them from (ADR 0071). `pnpm site:deploy` builds `origin/main` and checks out each
// content path from the release tag, so the docs describe the CLI that npm serves.
// `site-content.test.ts` fails when the site reads a path outside apps/web that neither list
// names, because such a path would ship from `main` without anyone deciding it should.
//
// Imports nothing. Node 24 strips the types.

/** Repo-relative paths the site reads as content. A site deploy takes them from the tag. */
export const CONTENT_PATHS = [
  "docs/wiki",
  "modules",
  "packages/cli/package.json",
  "llms.txt",
] as const;

/** Repo-relative paths outside apps/web that the site reads as code. They come from `main`. */
export const CODE_PATHS: readonly string[] = [];

/** Whether the repo-relative `path` is one of `roots` or sits under one. */
export function isUnder(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}
