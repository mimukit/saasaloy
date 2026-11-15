// The RSS 2.0 and sitemap builders behind `<basePath>/rss.xml` and `<basePath>/sitemap.xml`
// on `apps/web`. Plain strings, no XML library: both formats are small and fixed, and the
// web Worker should carry no dependency for them.

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

// Characters XML 1.0 cannot carry at all, even escaped: C0 controls other than tab, line
// feed and carriage return, lone surrogates, and U+FFFE and U+FFFF.
const INVALID_XML_CHARS =
  // oxlint-disable-next-line no-control-regex -- the control characters are the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&apos;",
  "<": "&lt;",
  ">": "&gt;",
};

/** Escape text for an XML element or attribute, and drop what XML 1.0 cannot hold. */
export function escapeXml(value: string): string {
  return value
    .replaceAll(INVALID_XML_CHARS, "")
    .replaceAll(/["&'<>]/g, (char) => ENTITIES[char] ?? char);
}

/** An RFC 822 date in GMT, the form RSS 2.0 requires: "Mon, 12 Oct 2026 09:05:00 GMT". */
export function rfc822(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toUTCString();
}

function element(name: string, text: string, indent: string): string {
  return `${indent}<${name}>${escapeXml(text)}</${name}>`;
}

/** One post in the feed. `link` is absolute and doubles as the permalink guid. */
export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: Date | string;
}

/** The feed: the channel's required elements plus its items, newest first. */
export interface RssChannel {
  title: string;
  description: string;
  /** The blog index, absolute. */
  link: string;
  /** This feed's own address, absolute, for `atom:link rel="self"`. */
  feedUrl: string;
  /** The channel language, a BCP 47 tag. */
  language?: string;
  items: readonly RssItem[];
}

/**
 * An RSS 2.0 document. The channel carries `title`, `link` and `description` (required),
 * `language`, `lastBuildDate` from the newest item, and an `atom:link` to itself, which
 * the W3C feed validator asks for.
 */
export function buildRss(channel: RssChannel): string {
  const [newest] = channel.items;
  const head = [
    element("title", channel.title, "    "),
    element("link", channel.link, "    "),
    element("description", channel.description, "    "),
    ...(channel.language
      ? [element("language", channel.language, "    ")]
      : []),
    ...(newest
      ? [element("lastBuildDate", rfc822(newest.pubDate), "    ")]
      : []),
    `    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`,
  ];
  const items = channel.items.map((item) =>
    [
      "    <item>",
      element("title", item.title, "      "),
      element("link", item.link, "      "),
      element("description", item.description, "      "),
      element("pubDate", rfc822(item.pubDate), "      "),
      `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
      "    </item>",
    ].join("\n")
  );
  return `${XML_DECLARATION}${[
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    ...head,
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n")}\n`;
}

/** One sitemap row. `loc` is absolute; `lastmod` is an ISO date. */
export interface SitemapUrl {
  loc: string;
  lastmod?: Date | string;
}

/** A sitemaps.org 0.9 `urlset`. */
export function buildSitemap(urls: readonly SitemapUrl[]): string {
  const rows = urls.map((url) =>
    [
      "  <url>",
      element("loc", url.loc, "    "),
      ...(url.lastmod === undefined
        ? []
        : [
            element(
              "lastmod",
              url.lastmod instanceof Date
                ? url.lastmod.toISOString()
                : url.lastmod,
              "    "
            ),
          ]),
      "  </url>",
    ].join("\n")
  );
  return `${XML_DECLARATION}${[
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
  ].join("\n")}\n`;
}
