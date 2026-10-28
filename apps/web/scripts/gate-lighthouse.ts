// The Lighthouse half of the site gate (plan 0091, Gate tooling row). It serves the
// built site, then runs `lhci autorun` against `/` with lighthouserc.json, which asks
// for the mobile profile, takes three runs and asserts 95 or more on the median run in
// performance, accessibility, best practices and SEO. One run left the gate to runner
// noise: performance scored 94 to 96 on the same build. The site starts on the light theme, so this is the light
// theme; gate:a11y covers dark.
//
// lhci gets the Chromium Playwright installs (or CHROME_PATH), so CI installs one
// browser for both gates. Run it after a build:
// `pnpm --filter @saasaloy/web gate:lighthouse`.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromiumPath, serveDist } from "./serve-dist.ts";

const site = await serveDist();
const chromePath = await chromiumPath();

const child = spawn(
  "lhci",
  [
    "autorun",
    "--config=lighthouserc.json",
    `--collect.url=${site.origin}/`,
    `--collect.chromePath=${chromePath}`,
  ],
  { stdio: "inherit" }
);
let code = 1;
try {
  const [exitCode] = (await once(child, "exit")) as [number | null];
  code = exitCode ?? 1;
} catch (error) {
  console.error(`lhci did not start: ${String(error)}`);
}

await site.close();
process.exit(code);
