// The accessibility half of the site gate (plan 0091, Gate tooling row). It serves the
// built site, loads `/` in Chromium at 375, 768 and 1440 px in both themes, and runs
// axe-core at wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa on each load, contrast
// included. Each load also checks two things axe does not, as scripts/verify-a11y.ts does
// for the base template: the document is never wider than the viewport, and no animation
// runs under reduced motion. Any finding fails the run. The 404 page gets the same six
// loads.
//
// One more load, with motion allowed, holds the drawings to WCAG 2.2.2: no animation on
// the clock may run longer than 5s, since the page has no pause control. A scroll-tied
// animation moves only while the reader scrolls, so it is exempt. So is every drawing
// marked `data-loop-in-view`: its loops run while it is in view, by the owner's decision
// (plan 0092). The gate then scrolls each one out of view in turn and fails any of its
// animations that still runs.
//
// The theme is set the way a returning visitor sets it: the stored choice in
// localStorage, written before the page's own pre-paint script reads it. The script then
// checks that <html> carries the matching class, so a silent fallback to the default light
// theme cannot pass for a dark run.
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

        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          view: window.innerWidth,
        }));
        if (overflow.scroll > overflow.view) {
          failures += 1;
          console.error(
            `FAIL ${where}: document is ${overflow.scroll}px wide in a ${overflow.view}px viewport`
          );
        }

        const running = await page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) => animation.playState === "running").length
        );
        if (running > 0) {
          failures += 1;
          console.error(
            `FAIL ${where}: ${running} animation(s) run although reduced motion is requested`
          );
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

  // WCAG 2.2.2: with motion allowed, every animation on the document clock ends within
  // 5s of load. An infinite one has an endTime of Infinity.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${site.origin}/`, { waitUntil: "networkidle" });
  const longLoops = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.timeline === document.timeline)
      .filter((animation) => {
        const target =
          animation.effect instanceof KeyframeEffect
            ? animation.effect.target
            : null;
        return !target?.closest("[data-loop-in-view]");
      })
      .filter((animation) => {
        const end = animation.effect?.getComputedTiming().endTime;
        return typeof end === "number" && end > 5000;
      })
      .map((animation) =>
        animation instanceof CSSAnimation ? animation.animationName : "unnamed"
      )
  );
  if (longLoops.length > 0) {
    failures += longLoops.length;
    console.error(
      `FAIL / 1440px motion: ${longLoops.length} timed animation(s) run past 5s: ${[...new Set(longLoops)].join(", ")}`
    );
  } else {
    console.log("ok   / 1440px motion: no timed animation runs past 5s");
  }

  // Each looping drawing pauses once it leaves the viewport. The gate scrolls a drawing
  // into view, waits for it to run, then scrolls it out and fails any of its animations
  // that still runs. A drawing that `display: none` hides at this width has nothing to
  // run; the narrower loads have no motion check of their own.
  const drawings = await page.locator("[data-loop-in-view]").all();
  if (drawings.length === 0) {
    failures += 1;
    console.error("FAIL / 1440px motion: no [data-loop-in-view] drawing found");
  }
  for (const [index, drawing] of drawings.entries()) {
    if (!(await drawing.isVisible())) {
      continue;
    }
    const where = `/ 1440px motion: looping drawing ${index + 1}`;
    await drawing.scrollIntoViewIfNeeded();
    await drawing.and(page.locator(":not([data-offscreen])")).waitFor();
    // Above the first screen, scroll to the bottom; below it, back to the top.
    await drawing.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(
        0,
        top < window.innerHeight ? document.documentElement.scrollHeight : 0
      );
    });
    await drawing
      .and(page.locator("[data-offscreen]"))
      .waitFor({ timeout: 5000 });
    const running = await drawing.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running")
        .map((animation) =>
          animation instanceof CSSAnimation
            ? animation.animationName
            : "unnamed"
        )
    );
    if (running.length > 0) {
      failures += running.length;
      console.error(
        `FAIL ${where}: ${running.length} loop(s) run off screen: ${[...new Set(running)].join(", ")}`
      );
    } else {
      console.log(`ok   ${where}: its loops pause off screen`);
    }
  }
  await context.close();
} finally {
  await browser.close();
  await site.close();
}

if (failures > 0) {
  console.error(`gate:a11y failed with ${failures} finding(s).`);
  process.exit(1);
}
console.log("gate:a11y passed.");
