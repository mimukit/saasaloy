// The accessibility half of the site gate (plan 0091, Gate tooling row). It serves the
// built site, loads `/` in Chromium at 375, 768 and 1440 px in both themes, and runs
// axe-core at wcag2a, wcag2aa, wcag21aa and wcag22aa on each load, contrast included.
// Any violation fails the run. The 404 page gets the same six loads.
//
// The theme is set the way a returning visitor sets it: the stored choice in
// localStorage, written before the page's own pre-paint script reads it. The script then
// checks that <html> carries the matching class, so a silent fallback to the OS theme
// cannot pass for a dark run.
//
// Every load asks for reduced motion. The page's motion is additive, so the still state
// is the real one, and a blur-in caught half way would make contrast a coin toss.
//
// Run it after a build: `pnpm --filter @saasaloy/web gate:a11y`.

import { THEME_STORAGE_KEY } from "../src/lib/theme.ts";
import { chromiumPath, serveDist } from "./serve-dist.ts";

const ROUTES = ["/", "/404"] as const;
const WIDTHS = [375, 768, 1440] as const;
const THEMES = ["light", "dark"] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const { chromium } = await import("playwright");
const { AxeBuilder } = await import("@axe-core/playwright");

const site = await serveDist();
const browser = await chromium.launch({ executablePath: await chromiumPath() });
let failures = 0;

try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        reducedMotion: "reduce",
        viewport: { width, height: 900 },
      });
      await context.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const
      );
      const page = await context.newPage();
      for (const route of ROUTES) {
        const where = `${route} ${width}px ${theme}`;
        await page.goto(site.origin + route, { waitUntil: "networkidle" });

        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains("dark")
        );
        if (isDark !== (theme === "dark")) {
          failures += 1;
          console.error(
            `FAIL ${where}: <html> did not take the ${theme} theme`
          );
          continue;
        }

        const { violations } = await new AxeBuilder({ page })
          .withTags(AXE_TAGS)
          .analyze();
        if (violations.length === 0) {
          console.log(`ok   ${where}: 0 violations`);
          continue;
        }
        failures += violations.length;
        console.error(`FAIL ${where}: ${violations.length} violation(s)`);
        for (const violation of violations) {
          const targets = violation.nodes
            .slice(0, 3)
            .map((node) => node.target.join(" "))
            .join(", ");
          const more =
            violation.nodes.length > 3
              ? ` (+${violation.nodes.length - 3} more)`
              : "";
          console.error(
            `  ${violation.id}: ${violation.help} at ${targets}${more}`
          );
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await site.close();
}

if (failures > 0) {
  console.error(`gate:a11y failed with ${failures} finding(s).`);
  process.exit(1);
}
console.log("gate:a11y passed.");
