// Tests for infra's assets staging: the copy that keeps private build files off
// Cloudflare, and the mapping onto the provider's `assets.config`. Like the other module
// tests this file is repo-only — it is not in the descriptor's scaffold list — and it
// runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { stageAssets } from "./stage.ts";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "infra-stage-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write `files` (path -> contents) under a fresh service's `dist/`, return its dir. */
async function service(
  name: string,
  files: Record<string, string>
): Promise<string> {
  const dir = join(root, name);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(dir, "dist", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return dir;
}

/** Every file under `dir`, as sorted POSIX paths relative to it. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/")
    )
    .toSorted();
}

describe("stageAssets", () => {
  it("leaves out an .assetsignore match and the three root config files", async () => {
    const dir = await service("astro", {
      "index.html": "<h1>home</h1>",
      "404.html": "<h1>missing</h1>",
      "_astro/app.js": "console.log(1)",
      "wrangler.json": "{}",
      ".dev.vars": "SECRET=1",
      ".assetsignore": "wrangler.json\n.dev.vars\n",
      _headers:
        "/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n",
      _redirects: "/old /new 301\n",
    });
    const stageDir = join(root, "stage", "astro");

    const staged = await stageAssets(dir, { directory: "./dist" }, stageDir);

    assert.equal(staged.directory, stageDir);
    assert.deepEqual(await listFiles(stageDir), [
      "404.html",
      "_astro/app.js",
      "index.html",
    ]);
  });

  it("keeps a nested _headers and does not read a nested .assetsignore as rules", async () => {
    const dir = await service("nested", {
      "index.html": "home",
      "docs/_headers": "nested headers are an asset",
      "docs/.assetsignore": "index.html\n",
      "docs/index.html": "docs",
    });
    const stageDir = join(root, "stage", "nested");

    await stageAssets(dir, { directory: "./dist" }, stageDir);

    assert.deepEqual(await listFiles(stageDir), [
      "docs/.assetsignore",
      "docs/_headers",
      "docs/index.html",
      "index.html",
    ]);
  });

  it("maps root _headers, _redirects and the handling options onto the config", async () => {
    const headers = "/_astro/*\n  Cache-Control: immutable\n";
    const redirects = "/old /new 301\n";
    const dir = await service("config", {
      "index.html": "home",
      _headers: headers,
      _redirects: redirects,
    });

    const staged = await stageAssets(
      dir,
      {
        directory: "./dist",
        not_found_handling: "404-page",
        html_handling: "drop-trailing-slash",
      },
      join(root, "stage", "config")
    );

    assert.deepEqual(staged.config, {
      headers,
      redirects,
      notFoundHandling: "404-page",
      htmlHandling: "drop-trailing-slash",
    });
  });

  it("sets no headers or redirects key when the root files are missing", async () => {
    const dir = await service("spa", { "index.html": "app" });

    const staged = await stageAssets(
      dir,
      { directory: "./dist", not_found_handling: "single-page-application" },
      join(root, "stage", "spa")
    );

    assert.deepEqual(staged.config, {
      notFoundHandling: "single-page-application",
    });
    assert.equal("headers" in staged.config, false);
    assert.equal("redirects" in staged.config, false);
  });

  it("removes a file the previous run staged and this build no longer has", async () => {
    const dir = await service("rerun", {
      "index.html": "home",
      "old.html": "gone next build",
    });
    const stageDir = join(root, "stage", "rerun");
    await stageAssets(dir, { directory: "./dist" }, stageDir);
    await rm(join(dir, "dist", "old.html"));

    await stageAssets(dir, { directory: "./dist" }, stageDir);

    assert.deepEqual(await listFiles(stageDir), ["index.html"]);
  });

  it("never changes the service's own build output", async () => {
    const dir = await service("untouched", {
      "index.html": "home",
      "wrangler.json": "{}",
      ".assetsignore": "wrangler.json\n",
      _headers: "/*\n  X-Test: 1\n",
    });

    await stageAssets(
      dir,
      { directory: "./dist" },
      join(root, "stage", "untouched")
    );

    assert.deepEqual(await listFiles(join(dir, "dist")), [
      ".assetsignore",
      "_headers",
      "index.html",
      "wrangler.json",
    ]);
  });

  it("throws when the assets directory does not exist", async () => {
    const dir = await service("unbuilt", {});

    await assert.rejects(
      stageAssets(dir, { directory: "./dist" }, join(root, "stage", "unbuilt")),
      /no assets directory at/
    );
  });
});
