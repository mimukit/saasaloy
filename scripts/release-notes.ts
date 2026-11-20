// The GitHub Release body for a CLI release. `.release-it.js` passes `releaseNotes` to
// release-it's `github.releaseNotes`, which calls it with the release context. The body is
// the changelog for the version, then one line that links the npm package at that version.
// The repository home page lists only GitHub Packages, and the CLI ships to npmjs.org, so
// the Release is where a reader finds the package.

export const NPM_PACKAGE_URL = "https://www.npmjs.com/package/saasaloy";

export interface ReleaseNotesContext {
  changelog?: string;
  version: string;
}

export function npmLine(version: string): string {
  return `**npm:** [\`saasaloy@${version}\`](${NPM_PACKAGE_URL}/v/${version}). Install with \`npx saasaloy@${version} init\`.`;
}

export function releaseNotes(context: ReleaseNotesContext): string {
  const changelog = (context.changelog ?? "").trimEnd();
  const line = npmLine(context.version);
  return changelog ? `${changelog}\n\n---\n\n${line}\n` : `${line}\n`;
}
