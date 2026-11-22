// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { remarkDocsBlocks } from "./src/lib/docs-blocks.ts";
import { rehypeCodeFrame } from "./src/lib/docs-code.ts";
import { remarkDocsLinks } from "./src/lib/docs-links.ts";
import { readBuildInfo } from "./src/lib/build-info.ts";
import { SAMPLE_SITE_NAME } from "./src/lib/registry-inline.ts";
import { remarkDropStamp, remarkDropTitle } from "./src/lib/docs-title.ts";

// `astro build` gets its own Vite cache. Both commands keep pre-bundled dependencies under
// node_modules/.vite, each stamped with a hash of the config that made them. The two
// hashes always differ, and Vite deletes a cache whose hash does not match. So a build
// run beside a live `astro dev` deletes the dev server's deps_ssr folder, and the next
// module the dev server loads from it fails with "The file does not exist at
// .../deps_ssr/<dep>.js which is in the optimize deps directory". A separate folder for
// the build keeps the two apart; dev keeps the default.
/** @returns {import("astro").AstroIntegration} the integration that moves the build cache */
function separateBuildCache() {
  return {
    name: "separate-build-cache",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command === "build") {
          updateConfig({ vite: { cacheDir: "node_modules/.vite-build" } });
        }
      },
    },
  };
}

// Every React component the dev server can render, for Vite's dependency scan. See the
// `optimizeDeps` notes in `vite` below.
const COMPONENT_ENTRIES = [
  "src/**/*.tsx",
  "../../packages/cli/templates/base/packages/ui/src/blocks/*.tsx",
  "../../packages/cli/templates/kits/*/blocks/*.tsx",
  "../../modules/auth/files/ui/blocks/auth/*.tsx",
  "../../modules/waitlist/files/ui/blocks/waitlist.tsx",
  ...["button", "field", "input", "spinner"].map(
    (name) => `../../modules/shell/files/ui/components/shell/${name}.tsx`
  ),
];

// Static output — the marketing site is content-first, and every page here is
// prerendered at build time. `output: "static"` is written out rather than left to the
// default so the next person changing this file has to mean it.
//
// The Cloudflare adapter is registered anyway, and src/pages/500.astro is why. Astro
// only treats a 500 page as an error handler when an adapter is present; without one it
// is an ordinary page nothing ever routes to. The adapter also means the first page a
// module drops in with `prerender = false` runs on demand with no config change and
// inherits that same 500 screen.
//
// Registering it costs no Worker while everything is prerendered: the adapter builds in
// assets-only mode, emits no server entry, and moves the site to dist/client. That move
// is why wrangler.jsonc points `assets.directory` there — read its comment before you
// change either file.
//
// The public origin. Layout.astro builds each canonical URL, `og:url` and `og:image`
// from it as `Astro.site`, and src/pages/robots.txt.ts and sitemap.xml.ts do the same.
// The owner chose saasaloy.com on 2026-10-27 (docs/seo/0001-seo-saasaloy-com-2026-10-27.md)
// and attached it to the Brainaloy Labs account on 2026-11-02. Change this and
// wrangler.jsonc together.
// The dev port: 3000 in the main checkout, or the `DEV_PORT` that `wtports` writes into a
// linked worktree's apps/web/.env.local, hashed from the branch so two worktrees never
// share a port. A `DEV_PORT` in the shell wins over the file. The file is read here with
// node:util, because Astro loads .env files after this config is evaluated.
function devPort() {
  let fromFile;
  try {
    fromFile = parseEnv(
      readFileSync(new URL(".env.local", import.meta.url), "utf-8")
    ).DEV_PORT;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const value = process.env.DEV_PORT ?? fromFile;
  const port = value === undefined || value === "" ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `DEV_PORT is "${value}". It must be an integer from 1 to 65535. wtports writes it in apps/web/.env.local.`
    );
  }
  return port;
}

// The wiki pages' Markdown pipeline (plan 0114 Phase 3). Astro 7 renders Markdown with the
// native Satteri processor unless told otherwise; `unified()` keeps the remark and rehype
// plugin API, which a later plugin can use from the wider ecosystem. The remark plugin rewrites each
// relative link to its /docs URL, or to the file on GitHub at the release tag, and fails the
// build on a link to a wiki page that does not exist. The title plugin drops each page's own
// H1, which the layout prints. The rehype plugin frames each code block with a Copy button
// and each table with a scroll region. The blocks plugin turns each `saasaloy-*` fence into a list the islands replace
// and fails the build on an unknown one (src/lib/docs-blocks.ts). Syntax highlighting is off: shiki's inline colours would sit outside the brand
// tokens, so docs.css styles a code block with the same tokens as the command field.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliVersion = JSON.parse(
  readFileSync(join(repoRoot, "packages/cli/package.json"), "utf-8")
).version;

// The version and commit the docs header and the footer show. `git` runs here, in Node,
// because a page renders in workerd under `astro dev` and has no `child_process`. The result
// reaches the pages as the `__BUILD_INFO__` constant (src/env.d.ts). See
// src/lib/build-info.ts.
const buildInfo = readBuildInfo(repoRoot, cliVersion);

// Saasaloy UI (plan 0121). The block pages under src/pages/ui/ render the base template's
// own blocks, so a block has one source. `@repo/ui` and `@repo/config` resolve to the
// template's packages, the names the blocks import. The template folder holds no
// node_modules, so `dedupe` resolves the blocks' packages from apps/web.
const templateUi = join(
  repoRoot,
  "packages/cli/templates/base/packages/ui/src"
);
const templateConfig = join(
  repoRoot,
  "packages/cli/templates/base/packages/config/src"
);
// The module blocks of Saasaloy UI (plan 0121, Phase 5) resolve to their module sources,
// before the template aliases below claim `@repo/ui/blocks/*` and `@repo/ui/components/*`.
// The shell's brand mark is an SVG pair; the preview takes the public stand-in instead
// (registry/shell/brand-mark.tsx), so it shows what `shadcn add` gives a project.
const modulesRoot = join(repoRoot, "modules");
const MODULE_ALIASES = [
  {
    find: /^@repo\/ui\/blocks\/shell\/brand-mark$/,
    replacement: fileURLToPath(
      new URL("registry/shell/brand-mark.tsx", import.meta.url)
    ),
  },
  {
    find: /^@repo\/ui\/blocks\/auth\/(.+)$/,
    replacement: `${modulesRoot}/auth/files/ui/blocks/auth/$1`,
  },
  {
    find: /^@repo\/ui\/blocks\/waitlist$/,
    replacement: `${modulesRoot}/waitlist/files/ui/blocks/waitlist.tsx`,
  },
  {
    find: /^@repo\/ui\/components\/shell\/(.+)$/,
    replacement: `${modulesRoot}/shell/files/ui/components/shell/$1`,
  },
];
// The blocks of a second kit (plan 0121, Phase 7) live beside the template, at
// packages/cli/templates/kits/<kit>/blocks/. The preview imports them as
// `@saasaloy-kit/<kit>/<block>`, a name only this site uses; their own `@repo/ui` imports
// resolve to the template like any base block's.
const KIT_ALIASES = [
  {
    find: /^@saasaloy-kit\/([^/]+)\/(.+)$/,
    replacement: `${join(repoRoot, "packages/cli/templates/kits")}/$1/blocks/$2`,
  },
];
const TEMPLATE_ALIASES = [
  ...KIT_ALIASES,
  ...MODULE_ALIASES,
  {
    find: /^@repo\/ui\/(blocks|components|content|lib)\/(.+)$/,
    replacement: `${templateUi}/$1/$2`,
  },
  { find: /^@repo\/ui\/styles\/(.+)$/, replacement: `${templateUi}/styles/$1` },
  { find: /^@repo\/ui$/, replacement: `${templateUi}/index.ts` },
  { find: /^@repo\/config$/, replacement: `${templateConfig}/index.ts` },
];
const TEMPLATE_PACKAGES =
  /\/(?:packages\/cli\/templates\/(?:base\/packages|kits)|modules\/[^/]+\/files)\//;
const TEMPLATE_SOURCE =
  /\/(?:packages\/cli\/templates\/(?:base\/packages|kits)|modules\/[^/]+\/files)\/.+\.tsx?$/;
// A module block and the brand-mark stand-in read `siteName` from `@repo/ui`. The preview
// answers them with the sample name the public copy inlines, the same name the base blocks
// take as a prop, so the frame shows what an install gives.
const SAMPLE_IMPORTERS =
  /\/(?:modules\/[^/]+\/files|apps\/web\/registry)\/.+\.tsx?$/;
const SAMPLE_UI = "\0saasaloy-ui-sample";

// Compiles the template's TypeScript for the preview. Vite's transform reads the nearest
// tsconfig.json of each file, and the template's packages/ui and packages/config ones
// extend `@repo/tsconfig/base.json`, which resolves only inside a generated project, so a
// template file fails with "Tsconfig not found" and no Vite option turns the lookup off.
// This transform runs first, with the lookup off (`tsconfig: false`) and the React JSX
// runtime the blocks are written for, and hands Vite plain JavaScript.
/** @returns {import("vite").Plugin} the plugin */
function templateTransform() {
  /** @type {Promise<typeof import("vite")> | undefined} */
  let vite;
  return {
    name: "saasaloy-template-transform",
    enforce: "pre",
    resolveId(source, importer) {
      const fromSample = SAMPLE_IMPORTERS.test(importer?.split("?")[0] ?? "");
      const isUiRoot =
        source === "@repo/ui" || source === `${templateUi}/index.ts`;
      return fromSample && isUiRoot ? SAMPLE_UI : null;
    },
    load(id) {
      return id === SAMPLE_UI
        ? `export const siteName = ${JSON.stringify(SAMPLE_SITE_NAME)};`
        : null;
    },
    async transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!TEMPLATE_SOURCE.test(file)) {
        return null;
      }
      // apps/web has no direct `vite` dependency; take the one Astro runs.
      vite ??= import(
        createRequire(import.meta.resolve("astro")).resolve("vite")
      );
      const { transformWithOxc } = await vite;
      const result = await transformWithOxc(code, file, {
        jsx: { runtime: "automatic", importSource: "react" },
        tsconfig: false,
      });
      return { code: result.code, map: result.map, moduleType: "js" };
    },
  };
}

// The dependency scan bundles the template blocks too (COMPONENT_ENTRIES), and stops at
// the same tsconfig lookup unless it is off. A failed scan pre-bundles nothing, so every
// page finds its dependencies mid-request and reloads.
const SCAN_WITHOUT_TSCONFIG = { tsconfig: false };

const TEMPLATE_DEPENDENCIES = [
  "react",
  "react-dom",
  "lucide-react",
  "@base-ui/react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
];

export default defineConfig({
  site: "https://saasaloy.com",
  output: "static",
  // Sessions off. Left unset, the Cloudflare adapter reads this key, decides sessions are
  // wanted, and writes a `SESSION` KV namespace binding with no id into the config it
  // generates at dist/client/wrangler.json — which is the config `wrangler deploy` actually
  // reads (see wrangler.jsonc). A prerendered marketing site stores no session, so that
  // would be a namespace to provision for nothing. Note this is Astro's own `session`, not
  // an adapter option; passing it to `cloudflare()` below does nothing.
  session: false,
  // `imageService: "compile"` optimises images during the build and serves the results
  // as plain assets. The adapter's default would reach for Cloudflare's IMAGES binding
  // at runtime, which needs a Worker this site does not have.
  //
  // package.json pins @cloudflare/vite-plugin, which this file never imports. The
  // adapter takes it through a caret range, and each release of the plugin raises the
  // wrangler version it demands at startup, so an unpinned install pairs a new plugin
  // with our pinned wrangler and `astro dev` exits before it is ready. The direct pin
  // makes pnpm install the same plugin for the adapter. Move it and `wrangler` together:
  // they release as a pair.
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [react(), separateBuildCache()],
  markdown: {
    syntaxHighlight: false,
    processor: unified({
      syntaxHighlight: false,
      remarkPlugins: [
        remarkDropTitle,
        remarkDropStamp,
        [remarkDocsBlocks, { repoRoot }],
        [remarkDocsLinks, { repoRoot, version: cliVersion }],
      ],
      rehypePlugins: [rehypeCodeFrame],
    }),
  },
  // 3000 is the same port as a generated project's web app; a linked worktree takes its
  // hashed port (see devPort above). `strictPort` makes a busy port a loud failure
  // instead of a silent +1.
  server: { port: devPort() },
  vite: {
    // Tailwind 4 is a Vite plugin, not an Astro integration — `@astrojs/tailwind` is EOL
    // and never supported v4. The theme lives in src/styles: the @source globs in
    // globals.css, the tokens in brand.css, and the landing utilities in web.css, which
    // imports brand.css and which Layout.astro imports via `@web/styles/web.css`.
    plugins: [templateTransform(), tailwindcss()],
    // The template's TypeScript is compiled by templateTransform() below, so Vite's own
    // transform leaves it alone. See that function for why.
    oxc: {
      exclude: [/\.js$/, TEMPLATE_PACKAGES],
      jsxRefreshExclude: [TEMPLATE_PACKAGES],
    },
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
    server: { strictPort: true },
    // Dev only: pre-bundle every dependency the React components import before the
    // first request. In dev the adapter renders inside workerd, and Vite's scan starts
    // from the pages, so it never walks into the React blocks and components under src/.
    // Without these entries Vite finds
    // lucide-react, @base-ui/react and the rest mid-request, re-bundles, and reloads the
    // worker. The re-run components then import a fresh copy of react while
    // react-dom/server holds the old one, and every hook throws "Invalid hook call".
    // A glob, not an include list, so a new component is covered with no edit here.
    ssr: {
      optimizeDeps: {
        entries: COMPONENT_ENTRIES,
        rolldownOptions: SCAN_WITHOUT_TSCONFIG,
      },
    },
    // The browser needs the same entries. Its scan reads an .astro page's <script> tags but
    // not the frontmatter that imports an island, so the islands' own dependencies arrive
    // mid-request. Vite re-bundles, renames the shared chunks, and deletes the ones the
    // page already asked for: "The file does not exist at .../deps/react-dom-<hash>.js
    // which is in the optimize deps directory", then a full reload.
    optimizeDeps: {
      entries: COMPONENT_ENTRIES,
      rolldownOptions: SCAN_WITHOUT_TSCONFIG,
    },
    resolve: {
      // `@web` mirrors saasaloy.json's alias of the same name (apps/web/src) — that
      // alias only drives the CLI's file-placement when a module's files[] target
      // `@web/...`; this is what makes the dropped source's own `@web/...` imports
      // (e.g. a dropped page importing @web/components/*) actually resolve.
      alias: [
        {
          find: "@web",
          replacement: fileURLToPath(new URL("src", import.meta.url)),
        },
        ...TEMPLATE_ALIASES,
      ],
      dedupe: TEMPLATE_DEPENDENCIES,
      // Astro turns tsconfig `paths` resolution on, which reads the nearest tsconfig of the
      // importing file, and fails on a template file for the reason templateTransform()
      // gives. The one path this site's tsconfig maps, `@web/*`, is the alias above.
      tsconfigPaths: false,
    },
  },
});
