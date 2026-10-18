// The landing page's production bar, as a gate (plan 0068, issue #191). `build` and
// `typecheck` stay green on a page that fails a screen reader, scrolls sideways on a phone,
// or hydrates five islands where two were promised. This script looks at the built page the
// way a visitor does and fails on any of that.
//
// It serves the built playground from node:http, drives Playwright's Chromium over `/`,
// `/terms`, `/privacy` and `/404` at four widths in both themes (32 page loads), and runs
// these checks on each load:
//
//   axe       axe-core at wcag2a, wcag2aa and wcag21aa, contrast included
//   overflow  the document is never wider than the viewport
//   motion    with reduced motion requested, no animation is running
//   skip      the first Tab stop is a skip link whose target is <main>
//
// and these once, on `/` at desktop width:
//
//   islands   the page hydrates exactly the islands the plan allows (Navbar, PricingTable)
//   meta      the page carries og:title, og:description, og:url, twitter:card, canonical
//
// Every load runs with `reducedMotion: "reduce"`. The landing page's motion is additive, so
// the un-animated state is the real one, and a blur-in caught half way would turn contrast
// into a coin toss.
//
// Prerequisite: a built playground. `pnpm play:init`, seed packages/env/.env from its
// example, `pnpm -C .dev/playground env:setup`, then `pnpm -C .dev/playground build`. The
// nightly job in .github/workflows/smoke.yml runs exactly that. Playwright and axe are root
// devDependencies of this repo and never reach the template. Install the browser once with
// `pnpm exec playwright install chromium`.
//
// NOT part of `deps:verify`, the same call verify-preset and verify-content make: it needs a
// browser, and the repo's standing gate does not. Run it by hand — `pnpm verify:a11y` —
// after touching a block, the layout or the theme.

/// <reference lib="dom" />

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webDist = join(root, ".dev/playground/apps/web/dist");

export const ROUTES = ["/", "/terms", "/privacy", "/404"] as const;
export const WIDTHS = [360, 768, 1280, 1536] as const;
export const THEMES = ["light", "dark"] as const;
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

// The two islands plan 0068 allows. Every other block renders to static HTML. A new island
// is a decision, so it lands here in the same change as the `client:*` that creates it.
export const ALLOWED_ISLANDS = ["Navbar", "PricingTable"] as const;

export const REQUIRED_META = [
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
  'meta[name="twitter:card"]',
  'link[rel="canonical"]',
] as const;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export interface Finding {
  check: string;
  where: string;
  detail: string;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Map a request path onto a file in the built site, the way Workers static assets does
 * for this project: `/terms` serves `terms/index.html` (or `terms.html`), and a miss
 * serves `404.html` with status 404. A path that climbs out of the site root is a miss.
 */
export async function resolveRequest(
  siteRoot: string,
  urlPath: string
): Promise<{ file: string | null; status: number }> {
  const pathname = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relativePath = normalize(pathname).replace(/^[/\\]+/u, "");
  const base = join(siteRoot, relativePath);
  const inside = base === siteRoot || base.startsWith(siteRoot + sep);
  if (inside) {
    for (const candidate of [base, join(base, "index.html"), `${base}.html`]) {
      if (await isFile(candidate)) {
        return { file: candidate, status: 200 };
      }
    }
  }
  const notFound = join(siteRoot, "404.html");
  return { file: (await isFile(notFound)) ? notFound : null, status: 404 };
}

/** The islands a page hydrates that the plan does not allow, and the allowed ones it lost. */
export function islandFindings(
  hydrated: readonly string[],
  allowed: readonly string[] = ALLOWED_ISLANDS
): Finding[] {
  const findings: Finding[] = [];
  for (const name of hydrated) {
    if (!allowed.includes(name)) {
      findings.push({
        check: "islands",
        where: "/",
        detail: `${name} hydrates, but only ${allowed.join(" and ")} may ship JavaScript`,
      });
    }
  }
  for (const name of allowed) {
    if (!hydrated.includes(name)) {
      findings.push({
        check: "islands",
        where: "/",
        detail: `${name} no longer hydrates; update ALLOWED_ISLANDS if that is deliberate`,
      });
    }
  }
  return findings;
}

/** The required metadata selectors a page is missing. */
export function metaFindings(
  present: Readonly<Record<string, boolean>>
): Finding[] {
  return REQUIRED_META.filter((selector) => !present[selector]).map(
    (selector) => ({ check: "meta", where: "/", detail: `missing ${selector}` })
  );
}

function fail(message: string, ...detail: string[]): never {
  console.error(`verify-a11y: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

async function siteRootFor(dist: string): Promise<string> {
  // The Cloudflare adapter moves a static build into dist/client (see the template's
  // astro.config.mjs). An adapter-free build writes straight into dist.
  for (const candidate of [join(dist, "client"), dist]) {
    if (await isFile(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return fail(
    `no built site under ${dist}.`,
    "Build the playground first:",
    "  pnpm play:init",
    "  cp .dev/playground/packages/env/.env.example .dev/playground/packages/env/.env",
    "  pnpm -C .dev/playground env:setup",
    "  pnpm -C .dev/playground build"
  );
}

function serve(
  siteRoot: string
): Promise<{ origin: string; close: () => void }> {
  const server = createServer((request, response) => {
    void resolveRequest(siteRoot, request.url ?? "/").then(
      ({ file, status }) => {
        if (!file) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(status, {
          "content-type":
            CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        });
        createReadStream(file).pipe(response);
      }
    );
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        origin: `http://127.0.0.1:${port}`,
        close: () => {
          server.close();
        },
      });
    });
  });
}

async function main(): Promise<void> {
  const siteRoot = await siteRootFor(webDist);
  // Imported here, not at the top, so the unit tests import the pure helpers above
  // without loading a browser driver.
  const { chromium } = await import("playwright");
  const { AxeBuilder } = await import("@axe-core/playwright");

  const { origin, close } = await serve(siteRoot);
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    close();
    return fail(
      "Chromium did not start.",
      "Install it once with `pnpm exec playwright install chromium`.",
      String(error).split("\n")[0] ?? ""
    );
  }

  const findings: Finding[] = [];
  try {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          colorScheme: theme,
          reducedMotion: "reduce",
          viewport: { width, height: 900 },
        });
        const page = await context.newPage();
        for (const route of ROUTES) {
          const where = `${route} ${width}px ${theme}`;
          await page.goto(origin + route, { waitUntil: "networkidle" });

          const results = await new AxeBuilder({ page })
            .withTags(AXE_TAGS)
            .analyze();
          for (const violation of results.violations) {
            const targets = violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(" "))
              .join(", ");
            const more =
              violation.nodes.length > 3
                ? ` (+${violation.nodes.length - 3} more)`
                : "";
            findings.push({
              check: `axe:${violation.id}`,
              where,
              detail: `${violation.help} — ${targets}${more}`,
            });
          }

          const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            view: window.innerWidth,
          }));
          if (overflow.scroll > overflow.view) {
            findings.push({
              check: "overflow",
              where,
              detail: `document is ${overflow.scroll}px wide in a ${overflow.view}px viewport`,
            });
          }

          const running = await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running").length
          );
          if (running > 0) {
            findings.push({
              check: "motion",
              where,
              detail: `${running} animation(s) run although reduced motion is requested`,
            });
          }

          await page.keyboard.press("Tab");
          const skip = await page.evaluate(() => {
            const active = document.activeElement;
            if (!(active instanceof HTMLAnchorElement)) {
              return "the first Tab stop is not a link";
            }
            const hash = active.getAttribute("href") ?? "";
            const target = hash.startsWith("#")
              ? document.querySelector(`#${CSS.escape(hash.slice(1))}`)
              : null;
            return target?.tagName === "MAIN"
              ? null
              : `the first Tab stop (${hash === "" ? "no href" : hash}) does not target <main>`;
          });
          if (skip) {
            findings.push({ check: "skip", where, detail: skip });
          }

          if (route === "/" && theme === "light" && width === 1280) {
            const hydrated = await page.$$eval("astro-island", (islands) =>
              islands.map(
                (island) => island.getAttribute("component-export") ?? "?"
              )
            );
            findings.push(...islandFindings(hydrated));
            const present: Record<string, boolean> = {};
            for (const selector of REQUIRED_META) {
              present[selector] = (await page.$(selector)) !== null;
            }
            findings.push(...metaFindings(present));
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }

  const loads = THEMES.length * WIDTHS.length * ROUTES.length;
  if (findings.length === 0) {
    console.log(`verify-a11y: ok — ${loads} page loads, no findings.`);
    return;
  }
  const byCheck = new Map<string, Finding[]>();
  for (const finding of findings) {
    byCheck.set(finding.check, [
      ...(byCheck.get(finding.check) ?? []),
      finding,
    ]);
  }
  for (const [check, group] of byCheck) {
    console.error(`\n${check} (${group.length})`);
    for (const finding of group) {
      console.error(`  ${finding.where}: ${finding.detail}`);
    }
  }
  fail(`${findings.length} finding(s) across ${loads} page loads.`);
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
