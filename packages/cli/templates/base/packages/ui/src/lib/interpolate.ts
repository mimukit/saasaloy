// Fill the `{token}` placeholders in a content string (see ../content/landing.ts).
//
// This exists so copy can be data. A template literal —
// `` `${siteName} gives your product…` `` — is a function, which means it cannot be
// serialized, cannot be split per locale, and cannot be read by any extraction tool.
// A string with `{siteName}` in it can be all three.
//
// Single brace rather than `{{double}}`: widening `{x}` to `{{x}}` later is one regex,
// while narrowing risks eating literal braces someone meant to keep.

/**
 * Replace every `{token}` in `message` with `values[token]`.
 *
 * An unknown token is left exactly as written — a visible `{plan}` in the page is a bug
 * you can see and fix, where an empty gap is a bug you ship.
 *
 * ```ts
 * interpolate("Set up {siteName} in a minute.", { siteName: "Acme" });
 * // → "Set up Acme in a minute."
 * ```
 */
export function interpolate(
  message: string,
  values: Record<string, string | number>,
): string {
  return message.replace(/\{(\w+)\}/g, (token, key: string) =>
    key in values ? String(values[key]) : token,
  );
}
