// `pnpm play:smoke` (#187): run the smoke script of every module installed in
// `.dev/playground`, in the order `saasaloy.json` lists them, and print a total. A
// module's script lives at `modules/<name>/smoke.ts`, beside its descriptor, and is never
// copied into a project. See `scripts/smoke.ts` for the helper they share.
//
// It expects a running, freshly seeded playground: `pnpm play:up --preset full`. It exits
// 1 when a check fails, when the api does not answer, or when no installed module ships a
// script.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Smoke } from "./smoke.ts";
import type { SmokeScript } from "./smoke.ts";

const root = resolve(import.meta.dirname, "..");
const playground = resolve(root, ".dev/playground");
const api = process.env.API ?? "http://localhost:4000";

async function main(): Promise<void> {
  const config = resolve(playground, "saasaloy.json");
  if (!existsSync(config)) {
    throw new Error("no .dev/playground; run pnpm play:up first");
  }
  const { installed = [] } = JSON.parse(readFileSync(config, "utf-8")) as {
    installed?: string[];
  };
  const scriptOf = (name: string) => resolve(root, "modules", name, "smoke.ts");
  const modules = installed.filter((name) => existsSync(scriptOf(name)));
  if (modules.length === 0) {
    throw new Error("no installed module ships a smoke.ts");
  }
  try {
    await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(
      `the api does not answer on ${api}; run pnpm play:up first`
    );
  }
  const smoke = new Smoke(api);
  for (const name of modules) {
    console.log(`\n== ${name}`);
    const script = (
      (await import(pathToFileURL(scriptOf(name)).href)) as {
        default: SmokeScript;
      }
    ).default;
    try {
      await script(smoke);
    } catch (error) {
      smoke.check(
        `${name} ran to its end`,
        false,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  console.log(
    `\n[smoke] ${smoke.passed} passed, ${smoke.failed} failed, ${modules.length} module(s): ${modules.join(", ")}`
  );
  if (smoke.failed > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[smoke] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
