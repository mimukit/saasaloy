// The CLI version the page shows next to the proof-of-concept note, so a reader (and a
// crawler) sees how current the page is. Read from packages/cli/package.json at build
// time; the JSON is inlined into the prerender bundle, and only the version string
// reaches the HTML.

import cli from "../../../../packages/cli/package.json" with { type: "json" };

/** The published `saasaloy` CLI version, such as `0.8.0`. */
export const cliVersion: string = cli.version;
