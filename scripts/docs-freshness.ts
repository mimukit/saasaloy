// Lists the hand-written wiki pages that code has outrun (plan 0114, Phase 5).
//
// `docs/wiki/.wikimap.yaml` gives each page the repo paths it covers (`documents:`), and
// wikikit ends each verified page with a stamp line:
//
//   _Verified against `main`@`42cbf03` on 2026-09-11._
//
// Two modes answer two questions:
//
//   pnpm docs:freshness                  which pages have a covered path changed after their
//                                        stamp commit? (`git log <stamp>..HEAD -- <paths>`)
//   pnpm docs:freshness --base <ref>     which pages cover a path this pull request changes
//                                        while the pull request leaves the page alone?
//                                        (`git log <ref>..HEAD`, minus the pages it edits)
//
// `--json` prints the result for `docs-freshness-comment.ts`. The command always exits 0
// after a clean read: a stale page is information, never a failure, and the site workflow
// must not turn red on it. Only a bad flag or a missing git exits non-zero.
//
// The git calls run here, in Node, and never from a page or the site's build: a Worker
// has no git (plan 0114, Phase 3 spike).
//
// Imports node: builtins, `docs-wikimap.ts` and the site's stamp reader
// (apps/web/src/lib/docs-stamp.ts, import-free); Node 24 strips the types.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stampOf as readStamp } from "../apps/web/src/lib/docs-stamp.ts";
import { handWritten, readWikimap, WIKI_DIR } from "./docs-wikimap.ts";
import type { WikiPage } from "./docs-wikimap.ts";

export interface Commit {
  sha: string;
  subject: string;
}

/** One page that needs a look. */
export interface StalePage {
  /** Path under `docs/wiki/`. */
  path: string;
  title: string;
  /** The commit the page was verified against, when the mode reads a stamp. */
  stamp: string | undefined;
  /** The commits that touched a covered path, newest first. */
  commits: Commit[];
  /** Why the page is listed with no commit: it has no stamp, or the stamp is unknown. */
  note: string | undefined;
}

export interface Report {
  /** The `--base` ref, or undefined in stamp mode. */
  base: string | undefined;
  pages: StalePage[];
}

/** The git reads the report needs. A test fakes it; `repoGit` runs the real one. */
export interface Git {
  /** True when `ref` names a commit. */
  has(ref: string): boolean;
  /** The non-merge commits in `range` that touch a path matching a glob, newest first. */
  log(range: string, globs: readonly string[]): Commit[];
  /** The files that differ between `base` and `HEAD`, from the merge base. */
  changed(base: string): string[];
}

/**
 * The commit a page's stamp line names, or undefined when it has none. The site's docs header
 * reads the same line with the same rule.
 */
export function stampOf(markdown: string): string | undefined {
  return readStamp(markdown)?.sha;
}

/**
 * A release commit (`chore(release): v0.9.0`, from packages/cli/.release-it.js) bumps the
 * version in package.json files and writes the changelog. It changes no behavior a page
 * describes, and it lands on `main` with no pull request, so it would mark the pages that
 * cover those files stale after every release with no comment to say why.
 */
const RELEASE = "chore(release): ";

function behavioral(commits: Commit[]): Commit[] {
  return commits.filter((commit) => !commit.subject.startsWith(RELEASE));
}

function listed(
  page: WikiPage,
  stamp: string | undefined,
  commits: Commit[],
  note?: string
): StalePage {
  return { path: page.path, title: page.title, stamp, commits, note };
}

/**
 * The pages to check. `read(path)` returns a page's Markdown, and `base` switches from the
 * stamp mode to the pull request mode.
 */
export function findStale(options: {
  pages: readonly WikiPage[];
  read: (path: string) => string;
  git: Git;
  base?: string;
}): Report {
  const { git, base } = options;
  const pages: StalePage[] = [];
  const changed = base === undefined ? [] : git.changed(base);
  for (const page of handWritten(options.pages)) {
    if (base !== undefined) {
      if (changed.includes(`${WIKI_DIR}/${page.path}`)) {
        continue;
      }
      const commits = behavioral(git.log(`${base}..HEAD`, page.documents));
      if (commits.length > 0) {
        pages.push(listed(page, undefined, commits));
      }
      continue;
    }
    const stamp = stampOf(options.read(page.path));
    if (stamp === undefined) {
      pages.push(listed(page, undefined, [], "the page has no stamp"));
    } else if (git.has(stamp)) {
      const commits = behavioral(git.log(`${stamp}..HEAD`, page.documents));
      if (commits.length > 0) {
        pages.push(listed(page, stamp, commits));
      }
    } else {
      pages.push(
        listed(page, stamp, [], `the stamp commit ${stamp} is unknown`)
      );
    }
  }
  return { base, pages };
}

/** The real git, run in `root`. */
export function repoGit(root: string): Git {
  const run = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  return {
    has(ref) {
      try {
        run("cat-file", "-e", `${ref}^{commit}`);
        return true;
      } catch {
        return false;
      }
    },
    log(range, globs) {
      if (globs.length === 0) {
        return [];
      }
      return run(
        "log",
        "--no-merges",
        "--format=%h%x09%s",
        range,
        "--",
        ...globs.map((glob) => `:(glob)${glob}`)
      )
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          const [sha = "", ...subject] = line.split("\t");
          return { sha, subject: subject.join("\t") };
        });
    },
    changed(base) {
      return run("diff", "--name-only", `${base}...HEAD`)
        .split("\n")
        .filter((line) => line !== "");
    },
  };
}

/** The report as plain text, one block for each page. */
export function formatReport(report: Report): string {
  if (report.pages.length === 0) {
    return report.base === undefined
      ? "docs:freshness: every hand-written page is current.\n"
      : `docs:freshness: no page covers a file this change touches without changing the page (base ${report.base}).\n`;
  }
  const lines = [
    report.base === undefined
      ? `docs:freshness: ${report.pages.length} page(s) have covered files that changed after their stamp.`
      : `docs:freshness: ${report.pages.length} page(s) cover files this change touches (base ${report.base}).`,
  ];
  for (const page of report.pages) {
    lines.push("", `${WIKI_DIR}/${page.path} (${page.title})`);
    if (page.note !== undefined) {
      lines.push(`  ${page.note}`);
    }
    for (const commit of page.commits) {
      lines.push(`  ${commit.sha} ${commit.subject}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main(argv: string[]): number {
  const json = argv.includes("--json");
  const at = argv.indexOf("--base");
  const base = at === -1 ? undefined : argv[at + 1];
  const unknown = argv.filter(
    (arg, index) =>
      arg !== "--json" && arg !== "--base" && !(at !== -1 && index === at + 1)
  );
  if (
    unknown.length > 0 ||
    (at !== -1 && (base === undefined || base.startsWith("-")))
  ) {
    console.error(
      "usage: node scripts/docs-freshness.ts [--base <ref>] [--json]"
    );
    return 2;
  }
  const root = resolve(import.meta.dirname, "..");
  const git = repoGit(root);
  if (base !== undefined && !git.has(base)) {
    console.error(`docs:freshness: the base "${base}" is not a commit here.`);
    return 2;
  }
  const report = findStale({
    pages: readWikimap(root),
    read: (path) => readFileSync(join(root, WIKI_DIR, path), "utf-8"),
    git,
    base,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report)
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
