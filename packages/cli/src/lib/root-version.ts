// The root `package.json` `version` belongs to the project (ADR 0049). `pnpm release`
// bumps it on every release and `saasaloy update` never does, so the version alone
// never makes the managed root `package.json` read as edited. These two helpers are the
// whole rule: read the file as if it held the version the base wrote, and write a new
// render with the project's version kept.
//
// They work on the text, not on parsed JSON, so the file keeps its formatting byte for
// byte. The top-level key is the one line with exactly two spaces of indent, which is
// how the template and Prettier write it; a nested `version` sits deeper.

/** The root package.json, the one managed file whose version the project owns. */
export const ROOT_MANIFEST = "package.json";

const VERSION_LINE = /^( {2}"version":\s*")([^"]*)(")/m;

/** The top-level `version` of a package.json's text, or undefined when it has none. */
export function rootVersion(content?: string): string | undefined {
  return content === undefined ? undefined : VERSION_LINE.exec(content)?.[2];
}

/** The text with its top-level `version` set to `version`. A file with none is unchanged. */
export function withRootVersion(content: string, version: string): string {
  return content.replace(
    VERSION_LINE,
    (_line, start: string, _old: string, end: string) =>
      `${start}${version}${end}`
  );
}
