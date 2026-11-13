import { describe, expect, it } from "vitest";
import { pagePath, sitemapXml } from "./sitemap";

describe("sitemap", () => {
  it("lists the content pages with a trailing slash", () => {
    expect(pagePath("./index.astro")).toBe("/");
    expect(pagePath("./privacy.astro")).toBe("/privacy/");
    expect(pagePath("./docs/index.astro")).toBe("/docs/");
  });

  it("leaves out the error pages and dynamic routes", () => {
    expect(pagePath("./404.astro")).toBeUndefined();
    expect(pagePath("./500.astro")).toBeUndefined();
    expect(pagePath("./blog/[slug].astro")).toBeUndefined();
  });

  it("writes absolute, sorted URLs on the site's origin", () => {
    const xml = sitemapXml(
      ["./terms.astro", "./index.astro", "./404.astro", "./privacy.astro"],
      new URL("https://example.com")
    );
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toStrictEqual([
      "https://example.com/",
      "https://example.com/privacy/",
      "https://example.com/terms/",
    ]);
  });
});
