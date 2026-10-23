import { describe, expect, it } from "vitest";
import { resolveConfig } from "./deploy-production.ts";
import {
  findToken,
  parseReleaseArgs,
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

  it("writes CHANGELOG.md with the conventionalcommits preset and preMajor", () => {
    expect(releaseItOptions(config, { dryRun: false }).plugins).toStrictEqual({
      "@release-it/conventional-changelog": {
        preset: { name: "conventionalcommits", preMajor: true },
        infile: "CHANGELOG.md",
        header: "# Changelog",
      },
    });
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
        preset: {
          name: "conventionalcommits",
          preMajor: false,
          types: sections,
        },
      },
    });
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
