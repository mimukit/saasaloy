// The Lighthouse half of the site gate (plan 0091, Gate tooling row). It serves the
// built site, then runs `lhci autorun` once against `/` with lighthouserc.json, which
// asks for the mobile profile and asserts 95 or more in performance, accessibility,
// best practices and SEO. Headless Chromium reports a light OS, so this is the light
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
