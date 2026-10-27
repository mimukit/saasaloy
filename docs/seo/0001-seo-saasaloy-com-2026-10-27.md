# SEO and AEO audit: saasaloy.com landing page

- **URL:** `http://localhost:39549/` (the production build of `apps/web`, served by `apps/web/scripts/serve-dist.ts`)
- **Date:** 2026-10-27
- **Mode:** audit
- **Environment:** local (production build, no dev-server markers)
- **Production origin:** `https://saasaloy.com`, stated by the owner on 2026-10-27. The domain is not bought yet. `apps/web/astro.config.mjs:52` still holds `https://example.com`.
- **Branch:** `issue-287-add-a-public-site-and-design-system` at `9b5076fe`
- **Evidence rung:** rendered DOM (headless Chromium 1247) and raw HTML. The two agree: 1,309 words, one H1, no JSON-LD in both.
- **Coverage:** `n/a` here, verify at the preview or production stage: `TECH-HTTPS`, `TECH-HOST`, `AEO-WAF`, `AEO-ENTITY`, `OFF-PRESENCE`, `CONT-DEPTH` (competitor comparison), the bot probes, PageSpeed field data. `DATA-VALID` and `DATA-MATCH` read `n/a` because the page has no markup to test. No check reads `unverified`.

**Intake** (all *inferred* from the README, `landing.ts` and plan 0091):

- Site type: open source developer tool, a mix of the "SaaS and product" and "Documentation and developer" playbooks.
- Audience: developers who build a SaaS on Cloudflare.
- Target queries: "saas starter kit cloudflare", "open source saas starter kit", "cloudflare saas boilerplate", "astro saas starter".
- Search Console and Bing Webmaster Tools: none, because the site is not live.

## Scorecard

**0 Critical, 2 High, 14 of 26 checks pass.**

| Area | Pass |
|------|------|
| Crawl | 4 of 7 |
| Technical | 2 of 2 |
| Page | 4 of 7 |
| Structured data | 0 of 2 |
| Content | 2 of 5 |
| AEO | 2 of 3 |

Severity tally: 0 Critical, 2 High, 5 Medium, 5 Low.

## Fix these first

1. `CRAWL-CANON` (High). The canonical and `og:url` point at `https://example.com/`. Set `site: "https://saasaloy.com"` in `apps/web/astro.config.mjs:52`.
2. `PAGE-INTENT` (High). The words "starter kit" and "open source" occur 0 times in the visible page. Only the title and the meta description carry them. Put the category into the hero description.
3. `PAGE-SOCIAL` (Medium). No `og:image`, and `twitter:card` is `summary`. A link to the site in Slack, Discord or X shows no picture.
4. `CRAWL-SITEMAP` and `AEO-BOTS` (Medium, Low). `/robots.txt` and `/sitemap.xml` return 404. Add both as static files in `apps/web/public/`.
5. `DATA-PRESENT` and `DATA-ENTITY` (Medium). The page has no JSON-LD. Add one `@graph` with `Organization`, `WebSite` and `SoftwareSourceCode`.

## Findings

| ID | Area | Engine | Verdict | Evidence | Severity | Effort | Fix |
|----|------|--------|---------|----------|----------|--------|-----|
| `CRAWL-CANON` | Crawl | both | fail | `<link rel="canonical" href="https://example.com/">` and `og:url` `https://example.com/`. `404.html` also carries `https://example.com/404/`. | High | S | `apps/web/astro.config.mjs:52`: `site: "https://saasaloy.com",`. Update the comment above it, which says Phase 2 records the workers.dev URL. In `apps/web/src/layouts/Layout.astro:45`, emit the canonical only when the page is indexable, for example a `noindex` prop that `404.astro` and `500.astro` pass, which also adds `<meta name="robots" content="noindex">`. |
| `PAGE-INTENT` | Page | both | warn | H1 "A landing page today. Your next module tomorrow." Opening paragraph "Start small. Add the capabilities your product needs." Visible body counts: "starter kit" 0, "open source" 0, "Cloudflare" 12. | High | S | `apps/web/src/content/landing.ts:87`: `description: "An open source SaaS starter kit for Cloudflare. Start with a landing page. Add each module as source files you own."` The H1 can stay. Per AGENTS.md, a hero copy change that alters the layout goes through a mockup round first. |
| `CONT-ANSWER` | Content | ai | warn | No passage on the page says what Saasaloy is. The FAQ answers five sub-questions, but none is "What is Saasaloy?". | Medium | S | Add a first FAQ item in `landing.ts` (the `faq` block at line 210): "What is Saasaloy?" with a 40 to 60 word answer built from the README's first paragraph: open source, composable SaaS starter kit for Cloudflare, a CLI plus a module registry, source files you own, MIT license. |
| `PAGE-SOCIAL` | Page | both | fail | `og:title`, `og:description`, `og:url` present. No `og:image`. `twitter:card` is `summary`. | Medium | S | Put a 1200×630 PNG at `apps/web/public/og.png` (a crop of `assets/branding/readme-banners/06-module-map.png` is a start). In `Layout.astro` near line 57, add `<meta property="og:image" content={new URL("/og.png", Astro.site).href} />`, `og:image:width` 1200, `og:image:height` 630, `og:image:alt`, and change the card to `summary_large_image`. |
| `CRAWL-SITEMAP` | Crawl | search | fail | `GET /sitemap.xml` 404. `GET /robots.txt` 404, so no `Sitemap:` line. | Medium | S | Add `apps/web/public/sitemap.xml` with one `<url><loc>https://saasaloy.com/</loc></url>`. Move to `@astrojs/sitemap` when the site gets a second page, and exclude `/404` and `/500` there. |
| `DATA-PRESENT` | Data | both | fail | `jsonLd: []` in raw HTML and in the rendered DOM. | Medium | S | Add the JSON-LD block in the appendix to `Layout.astro` for the home page only, or to `index.astro` through a `head` slot. |
| `DATA-ENTITY` | Data | ai | fail | No `Organization` or `Person`, no `sameAs`, no logo. | Medium | S | The same block: `Organization` with `sameAs` to `https://github.com/mimukit/saasaloy` and `https://www.npmjs.com/package/saasaloy`, and `logo` to `https://saasaloy.com/favicon.svg` or a PNG. |
| `AEO-BOTS` | AEO | ai | fail | No `robots.txt`, so every agent is allowed by default and no purpose has a stated rule. | Low | S | Add `apps/web/public/robots.txt` from the appendix. It allows every purpose, which suits an open source project that wants citations and wants assistants to read the docs. |
| `PAGE-DESC` | Page | search | warn | 197 characters. Google cuts it near 155 to 160. | Low | S | `landing.ts:67`: "{siteName} is an open source SaaS starter kit for Cloudflare. Start with a landing page, then add the API, database, auth and more as source files you own." (153 characters with the name filled in) |
| `CRAWL-LINKS` | Crawl | both | warn | 16 of 17 links answer 200. `https://github.com/mimukit/saasaloy/tree/main/apps/web` answers 404, because `apps/web` is not on `main` yet. The only internal links are two logo links to `/`. | Low | S | No change. The link resolves when this branch merges. Re-check it after the merge. |
| `CONT-DATE` | Content | both | warn | No visible date or version on the page. The changelog is one click away on GitHub. | Low | S | Show the current CLI version near the proof-of-concept note, for example "v0.x.y, see changelog", read at build time from `packages/cli/package.json`. |
| `CONT-TRUST` | Content | both | warn | The footer links GitHub, Getting started, Changelog and MIT license. No privacy page, and plan 0091 adds the Cloudflare Web Analytics beacon. | Low | S | Add a short privacy note (page or footer section) that names the cookieless Cloudflare Web Analytics before the beacon ships. |

Checks that pass, with their evidence:

- `CRAWL-STATUS`: 200, no redirects.
- `CRAWL-ROBOTS`: no `robots.txt`, so Googlebot and Bingbot are allowed.
- `CRAWL-NOINDEX`: no robots meta, no `X-Robots-Tag`.
- `CRAWL-RENDER`: 1,309 words in raw HTML, the same in the rendered DOM. The FAQ uses native `<details>`, so all five answers are in the HTML.
- `TECH-CWV`: lab, local machine, Lighthouse mobile. LCP 2.3 s, CLS 0, TBT 40 ms (a proxy for INP). Performance 0.97, SEO 1.0. LCP is close to the 2.5 s limit. Its element is the H1 span "Your next module tomorrow.", with 1,210 ms of render delay, and Lighthouse lists `Layout.DSfryvuZ.css` as render-blocking (est. 650 ms saving).
- `TECH-MOBILE`: `width=device-width, initial-scale=1`.
- `PAGE-TITLE`: "Saasaloy: an open source SaaS starter kit for Cloudflare", 56 characters, topic in the first 60.
- `PAGE-HEAD`: one H1, five H2, no skipped level.
- `PAGE-IMG`: no `<img>`. The illustrations are inline SVG, so the LCP is text.
- `PAGE-ANCHOR`: anchors carry their topic ("Getting started", "Waitlist", "Changelog").
- `CONT-AUTHOR`: a developer tool is not a health, money or legal topic. The GitHub owner is one click away.
- `CONT-SOURCE`: product claims link to the docs and the source.
- `AEO-EXTRACT`: the FAQ uses question text ("Do I need a Cloudflare account?"), the stages are an ordered list, the module catalog is a list in raw HTML.
- `AEO-FILES`: no `llms.txt`. It is optional, so absence passes.

## AI readiness

Bot access matrix, from the `robots` verdict for `/`. Probe status is `n/a` in local.

| Agent | Purpose | robots.txt rule | Probe |
|-------|---------|-----------------|-------|
| Googlebot, Bingbot | search | allowed (no file) | n/a |
| OAI-SearchBot, Claude-SearchBot, PerplexityBot | AI search | allowed (no file) | n/a |
| ChatGPT-User, Claude-User, Perplexity-User | user retrieval | allowed (no file) | n/a |
| GPTBot, ClaudeBot, CCBot | training | allowed (no file) | n/a |
| Google-Extended, Applebot-Extended | product tokens | allowed (no file) | n/a |

Extractability: good. All copy is in raw HTML, and only the navbar and the two copy buttons hydrate. The gap is content, not markup. No passage defines Saasaloy, so an engine that answers "what is a SaaS starter kit for Cloudflare" has nothing on this page to quote.

## Long-term plan

**Fix now** (this week, before the first deploy):

- `CRAWL-CANON`: set `site` to `https://saasaloy.com`, and drop the canonical from the error pages.
- `PAGE-INTENT` and `CONT-ANSWER`: category words in the hero description, plus a "What is Saasaloy?" FAQ item.
- `PAGE-SOCIAL`: `og:image` and `summary_large_image`.
- `CRAWL-SITEMAP`, `AEO-BOTS`: `public/robots.txt` and `public/sitemap.xml`.
- `DATA-PRESENT`, `DATA-ENTITY`: the JSON-LD `@graph`.
- Pre-deploy: after the domain is bought and attached, run `audit` on `https://saasaloy.com/` to clear `TECH-HTTPS`, `TECH-HOST` (`www` to bare, `http` to `https`), `AEO-WAF` (Cloudflare Bot Fight Mode can challenge AI agents on a zone; plan 0091 used workers.dev, which has no zone), the bot probes and PageSpeed. Also make the `saasaloy.<account>.workers.dev` host redirect to `saasaloy.com` or turn it off, so two hosts do not split signals. Set the GitHub repository `homepage` and `packages/cli/package.json` `homepage` to the new domain.

**Build next** (one to three months):

- Docs on the domain (playbook: developer sites, "static or server-rendered docs"). The docs live on GitHub now, so every "Getting started" link sends authority to github.com and not to saasaloy.com. Docs at `saasaloy.com/docs/` would also take `@astrojs/sitemap` and an `llms.txt` index (playbook: developer sites, `llms.txt`).
- One page per main module (auth, payment, queue, database driver), each with its command, its files and its providers. The module catalog rows are the seed.
- An honest comparison page (playbook: SaaS, "comparison pages that name the category leader") against the starter kits developers already search for, with the difference stated as the module model: copied source, not a fork of a boilerplate.
- One product description everywhere (playbook: SaaS, "one consistent product description"). The page says "open source, composable SaaS starter kit". The GitHub description says "Composable SaaS accelerator for Cloudflare; a CLI + module registry, not a boilerplate". The npm description says "Composable SaaS accelerator kit.". Pick one sentence and use it in all three and in the `Organization` markup.

**Keep doing:**

- Verify `saasaloy.com` in Search Console and Bing Webmaster Tools on the day it goes live, and check both monthly. Neither one reports AI answers on their own.
- Track AI visibility by hand. Use 10 to 20 prompts such as "open source SaaS starter kit for Cloudflare" and "how do I add auth to a Cloudflare Workers app". Run each 3 to 5 times per engine in a fresh session each month, and record a rate ("cited 2 of 5").
- Keep the changelog dated, and show the current version on the page.
- Earn mentions where developers look (GitHub topics, Hacker News Show HN, Reddit r/CloudFlare, dev.to write-ups), because citation sources change between model releases.
- Re-run seokit after each release that touches `Layout.astro` or `landing.ts`.

**Do not** (from the playbooks):

- Publish a self-ranked "best SaaS starter kits" list. Answer engines cite it as a category source and then recommend the established kits.
- Make one landing page per keyword with swapped nouns ("SaaS starter for Next.js", "for Remix").
- Block `ChatGPT-User` or `Claude-User`. Developers ask assistants to read the docs for them.
- Sell `FAQPage` markup as a Google win. Google stopped FAQ rich results on 2026-05-07. Other engines still read the visible FAQ.

## Since last audit

Not applicable. This is the first report for `saasaloy-com`.

## Appendix

### Proposed `apps/web/public/robots.txt`

```text
# Search, AI search and user-triggered retrieval: allowed.
# Training crawlers: allowed. Change these lines to opt out.
User-agent: *
Allow: /

Sitemap: https://saasaloy.com/sitemap.xml
```

### Proposed `apps/web/public/sitemap.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://saasaloy.com/</loc>
  </url>
</urlset>
```

### Proposed JSON-LD for the home page

`SoftwareApplication` is left out on purpose. Google requires `aggregateRating` or `review` for that rich result, and the project has neither. `SoftwareSourceCode` states the facts the page shows.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://saasaloy.com/#organization",
      "name": "Saasaloy",
      "url": "https://saasaloy.com/",
      "logo": "https://saasaloy.com/favicon.svg",
      "sameAs": [
        "https://github.com/mimukit/saasaloy",
        "https://www.npmjs.com/package/saasaloy"
      ]
    },
    {
      "@type": "WebSite",
      "@id": "https://saasaloy.com/#website",
      "url": "https://saasaloy.com/",
      "name": "Saasaloy",
      "publisher": { "@id": "https://saasaloy.com/#organization" },
      "inLanguage": "en"
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "https://saasaloy.com/#software",
      "name": "Saasaloy",
      "description": "An open source, composable SaaS starter kit for Cloudflare: a CLI plus a module registry that copies source files into your repository.",
      "codeRepository": "https://github.com/mimukit/saasaloy",
      "programmingLanguage": "TypeScript",
      "license": "https://github.com/mimukit/saasaloy/blob/main/LICENSE.md",
      "author": { "@id": "https://saasaloy.com/#organization" }
    }
  ]
}
```

### Raw evidence

- `extract` on `/` with `--origin https://saasaloy.com`: status 200, `lang` "en", title "Saasaloy: an open source SaaS starter kit for Cloudflare", canonical `https://example.com/`, `jsonLd: []`, `rawWordCount` 1309, `h1Count` 1, links 2 internal, 15 external, 0 script-only, 1 fragment (the skip link), `devMarkers: []`.
- `curl` status: `/robots.txt` 404, `/sitemap.xml` 404, `/sitemap-index.xml` 404, `/llms.txt` 404.
- Lighthouse 13 via `npx -y lighthouse`, mobile profile, headless Chromium 1247, one run, on the local server. Lab data, local machine, not field data.
- External link check: `curl -L` on the seven unique GitHub URLs, 2026-10-27.

### Sources

- Google FAQ rich results end, 2026-05-07: seokit check catalog, as of 2026-10.
- `SoftwareApplication` rich result requirements: seokit `references/structured-data.md`.
- Core Web Vitals limits (LCP 2.5 s, INP 200 ms, CLS 0.1): web.dev, current as of 2026-10.
