// `SAASALOY_ENGINE=next` selects the render engine inside the #365 branch (plan 0116,
// "The flag during the build"). `init`, `add`, `remove` and `update` read it on their
// first line and hand the whole run to `commands/next.ts`. Phase 6 makes the render
// engine the default and deletes this file, so the flag never ships.

export const ENGINE_ENV = "SAASALOY_ENGINE";

/** True when the run takes the render engine. */
export function nextEngineSelected(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[ENGINE_ENV] === "next";
}
