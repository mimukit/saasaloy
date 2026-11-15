// The page list behind src/pages/sitemap.xml.ts, kept apart from the route so a test can
// call it: a `.ts` file in src/pages/ is itself a route, a test file included.
//
// Left out: the error pages, which have no address of their own, and any dynamic route
// (`[slug].astro`), whose real paths only its getStaticPaths knows. Add a route here when
// it is personal or `noindex` (a login page, a cart). A module that adds a public dynamic
// route lists its paths in the sitemap route itself.
const EXCLUDED = new Set(["404", "500"]);

/** The served path of one page file from `import.meta.glob("./**\/*.astro")`, or undefined. */
export function pagePath(file: string): string | undefined {
  const route = file.replace(/^\.\//, "").replace(/\.astro$/, "");
  if (EXCLUDED.has(route) || route.includes("[")) {
    return undefined;
  }
  if (route === "index") {
    return "/";
  }
  // The build writes each page as a directory, so the served path ends in a slash.
  return `/${route.replace(/\/index$/, "")}/`;
}

/** The sitemap XML for `files`, each resolved against `site`. */
export function sitemapXml(files: string[], site: URL): string {
  const urls = files
    .map(pagePath)
    .filter((path) => path !== undefined)
    .toSorted()
    .map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
