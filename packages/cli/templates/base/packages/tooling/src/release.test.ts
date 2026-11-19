import { describe, expect, it } from "vitest";
import { resolveConfig } from "./deploy-production.ts";
import {
  belowOne,
  checkIncludePaths,
  findToken,
  includeHooks,
  missingIncludeProblem,
  parseReleaseArgs,
  preMajorBump,
  releaseItOptions,
  tokenProblem,
} from "./release.ts";

const config = resolveConfig({});

describe(parseReleaseArgs, () => {
  it("takes no argument as the version the commits ask for", () => {
    expect(parseReleaseArgs([])).toStrictEqual({ dryRun: false });
  });

  it("reads --dry-run and one increment or exact version", () => {
    expect(parseReleaseArgs(["--", "minor", "--dry-run"])).toStrictEqual({
      dryRun: true,
      increment: "minor",
    });
    expect(parseReleaseArgs(["1.0.0"])).toStrictEqual({
      dryRun: false,
      increment: "1.0.0",
    });
  });

  it("accepts --ci, because the run never asks anyway", () => {
    expect(parseReleaseArgs(["--ci"])).toStrictEqual({ dryRun: false });
  });

  it("refuses an unknown word and a second increment", () => {
    expect(() => parseReleaseArgs(["--force"])).toThrow(
      /Unknown argument --force/
    );
    expect(() => parseReleaseArgs(["minor", "major"])).toThrow(
      /Unknown argument major/
    );
  });
});

describe(releaseItOptions, () => {
  it("reads no config file, asks nothing, and publishes nothing to npm", () => {
    const options = releaseItOptions(config, { dryRun: false });
    expect(options).toMatchObject({
      config: false,
      ci: true,
      "dry-run": false,
      npm: { publish: false },
    });
    expect(options).not.toHaveProperty("increment");
  });

  it("takes the deploy's branch list and keeps the clean-tree check on", () => {
    const options = releaseItOptions(
      resolveConfig({ branches: ["main", "hotfix-*", "release"] }),
      { dryRun: false }
    );
    expect(options.git).toMatchObject({
      requireBranch: ["main", "hotfix-*", "release"],
      requireCleanWorkingDir: true,
      requireUpstream: true,
      requireCommits: true,
    });
  });

  it("names the commit, the tag and the GitHub Release with the tag prefix", () => {
    const options = releaseItOptions(config, {
      dryRun: true,
      increment: "minor",
    });
    expect(options).toMatchObject({ "dry-run": true, increment: "minor" });
    expect(options.git).toMatchObject({
      commitMessage: `chore(release): v\${version}`,
      tagName: `v\${version}`,
      tagAnnotation: `Release v\${version}`,
    });
    expect(options.github).toStrictEqual({
      release: true,
      releaseName: `v\${version}`,
      tokenRef: "GITHUB_TOKEN",
    });
  });

  it("writes CHANGELOG.md with the conventionalcommits preset, and its own bump below 1.0", () => {
    expect(
      releaseItOptions(config, { dryRun: false }, "0.0.0").plugins
    ).toStrictEqual({
      "@release-it/conventional-changelog": {
        preset: { name: "conventionalcommits" },
        whatBump: preMajorBump,
        infile: "CHANGELOG.md",
        header: "# Changelog",
      },
    });
  });

  it("keeps the preset's own bump at 1.0 and above, or with preMajor off", () => {
    const plugin = "@release-it/conventional-changelog";
    expect(
      releaseItOptions(config, { dryRun: false }, "1.2.0").plugins
    ).not.toHaveProperty([plugin, "whatBump"]);
    expect(
      releaseItOptions(
        resolveConfig({ release: { preMajor: false } }),
        { dryRun: false },
        "0.3.0"
      ).plugins
    ).not.toHaveProperty([plugin, "whatBump"]);
  });

  it("passes the project's own changelog sections, prefix and choices", () => {
    const sections = [{ type: "refactor", section: "Refactors" }];
    const options = releaseItOptions(
      resolveConfig({
        release: {
          tagPrefix: "release-",
          githubRelease: false,
          preMajor: false,
          changelogSections: sections,
        },
      }),
      { dryRun: false }
    );
    expect(options.git).toMatchObject({ tagName: `release-\${version}` });
    expect(options.github).toMatchObject({ release: false });
    expect(options.plugins).toMatchObject({
      "@release-it/conventional-changelog": {
        preset: { name: "conventionalcommits", types: sections },
      },
    });
  });
});

describe(includeHooks, () => {
  it("stages each release.include path, quoted, before the release commit", () => {
    const options = releaseItOptions(
      resolveConfig({
        release: { include: ["docs/release/", "notes/v1_2-x.md"] },
      }),
      { dryRun: false }
    );
    expect(options.hooks).toStrictEqual({
      "before:git:release": [
        "git add -- 'docs/release/'",
        "git add -- 'notes/v1_2-x.md'",
      ],
    });
  });

  it("adds no hook for an empty or unset list", () => {
    expect(includeHooks([])).toStrictEqual({});
    expect(releaseItOptions(config, { dryRun: false })).not.toHaveProperty(
      "hooks"
    );
  });

  it("refuses an absolute path, a .. segment and a space before release-it runs", () => {
    expect(() => checkIncludePaths(["/etc/passwd"])).toThrow(/is absolute/);
    expect(() => checkIncludePaths(["docs/../secrets"])).toThrow(
      /has a \.\. segment/
    );
    expect(() => checkIncludePaths(["docs/my notes.md"])).toThrow(
      /character outside/
    );
    for (const root of [".", "./", "./."]) {
      expect(() => checkIncludePaths([root])).toThrow(
        /names the repository root/
      );
    }
    expect(() =>
      releaseItOptions(
        resolveConfig({ release: { include: ["docs/'; rm -rf ~; '"] } }),
        { dryRun: false }
      )
    ).toThrow(/release did not start/);
  });
});

describe(missingIncludeProblem, () => {
  it("refuses a real release whose include path is missing, and lets a dry run through", () => {
    const none = (): boolean => false;
    expect(
      missingIncludeProblem(["docs/release/"], { dryRun: false }, none)
    ).toMatch(/names docs\/release\/, and nothing is there/);
    expect(
      missingIncludeProblem(["docs/release/"], { dryRun: true }, none)
    ).toBeUndefined();
    expect(
      missingIncludeProblem(["docs/release/"], { dryRun: false }, () => true)
    ).toBeUndefined();
  });

  it("refuses a real release whose include path git ignores", () => {
    const all = (): boolean => true;
    expect(
      missingIncludeProblem(["docs/release/"], { dryRun: false }, all, all)
    ).toMatch(/git ignores release\.include path docs\/release\//);
    expect(
      missingIncludeProblem(["docs/release/"], { dryRun: true }, all, all)
    ).toBeUndefined();
  });
});

describe(preMajorBump, () => {
  it("bumps the minor for a feat, so the first release is 0.1.0", () => {
    expect(
      preMajorBump([
        { type: "feat", notes: [] },
        { type: "fix", notes: [] },
      ])
    ).toMatchObject({ level: 1 });
  });

  it("bumps the minor, never the major, for a breaking change", () => {
    expect(
      preMajorBump([{ type: "chore", notes: ["dropped x"] }])
    ).toMatchObject({ level: 1 });
  });

  it("bumps the patch for fixes only, and nothing for chores", () => {
    expect(preMajorBump([{ type: "perf", notes: [] }])).toMatchObject({
      level: 2,
    });
    expect(preMajorBump([{ type: "chore", notes: [] }])).toBeNull();
  });
});

describe(belowOne, () => {
  it("is true below 1.0 and for a project with no version", () => {
    expect(belowOne("0.3.0")).toBeTruthy();
    expect(belowOne()).toBeTruthy();
    expect(belowOne("1.0.0")).toBeFalsy();
  });
});

describe(findToken, () => {
  it("takes GITHUB_TOKEN first and never asks gh then", () => {
    expect(
      findToken({ GITHUB_TOKEN: "env-token" }, () => {
        throw new Error("gh must not run");
      })
    ).toBe("env-token");
  });

  it("falls back to gh when GITHUB_TOKEN is unset or blank", () => {
    expect(findToken({}, () => "gh-token")).toBe("gh-token");
    expect(findToken({ GITHUB_TOKEN: " " }, () => "gh-token")).toBe("gh-token");
    // oxlint-disable-next-line unicorn/no-useless-undefined -- a gh with no token answers undefined
    expect(findToken({}, () => undefined)).toBeUndefined();
  });
});

describe(tokenProblem, () => {
  it("refuses a real release with no token, and names both fixes", () => {
    const problem = tokenProblem(undefined, config, { dryRun: false }) ?? "";
    expect(problem).toMatch(/did not start/);
    expect(problem).toMatch(/gh auth login/);
    expect(problem).toMatch(/GITHUB_TOKEN/);
  });

  it("lets a token, a dry run, or a project with no GitHub Release through", () => {
    expect(tokenProblem("token", config, { dryRun: false })).toBeUndefined();
    expect(tokenProblem(undefined, config, { dryRun: true })).toBeUndefined();
    expect(
      tokenProblem(
        undefined,
        resolveConfig({ release: { githubRelease: false } }),
        { dryRun: false }
      )
    ).toBeUndefined();
  });
});
