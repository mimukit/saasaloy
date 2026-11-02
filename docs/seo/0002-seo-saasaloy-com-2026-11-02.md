# SEO and AEO audit: saasaloy.com landing page

- **URL:** `https://saasaloy.com/`
- **Date:** 2026-11-02
- **Mode:** audit
- **Environment:** production. No local server answered on port 3000 or 4321, and the custom domain went live on 2026-11-02, so this run audits the live site.
- **Production origin:** `https://saasaloy.com`, from `site` in `apps/web/astro.config.mjs:54`. That value is an uncommitted change in the working tree. `main` at `1500464e` still holds `https://saasaloy.brainaloy.workers.dev`.
- **Evidence rung:** rendered DOM (headless Chromium 1247, `--dump-dom`) and raw HTML. The two agree: 1,568 words, one H1, one JSON-LD `@graph` in both.
- **Coverage:** no check reads `n/a` or `unverified`. `TECH-CWV` uses lab data, because PageSpeed Insights returned HTTP 429 (daily quota) and a domain that is one day old has no Chrome UX Report field data.

**Intake** (all *inferred* from report 0001, `apps/web/src/content/landing.ts` and the README):

- Site type: open source developer tool, a mix of the "SaaS and product" and "Documentation and developer" playbooks.
- Audience: developers who build a SaaS on Cloudflare.
- Target queries: "open source saas starter kit cloudflare" (primary), "cloudflare saas boilerplate", "saas starter kit cloudflare workers", "astro saas starter".
- Search Console and Bing Webmaster Tools: no data, because the domain went live today.

## Scorecard

**0 Critical, 0 High, 29 of 34 checks pass.**

| Area | Pass |
|------|------|
| Crawl | 7 of 7 |
| Technical | 3 of 4 |
| Page | 7 of 7 |
| Structured data | 4 of 4 |
| Content | 4 of 6 |
| AEO | 4 of 5 |
| Off-site | 0 of 1 |

Severity tally: 0 Critical, 0 High, 4 Medium, 1 Low.

## Fix these first

1. **Repository config, not a page check.** The live site serves the canonical `https://saasaloy.com/`, but that comes from uncommitted edits to `apps/web/astro.config.mjs` and `apps/web/wrangler.jsonc`. A deploy from `main` today would set every canonical, `og:url`, sitemap URL and JSON-LD `@id` back to `saasaloy.brainaloy.workers.dev`, and would turn the workers.dev host back on. Commit both files before any deploy, and before the deploy-on-push job (issue #199) lands.
2. `TECH-CWV` (Medium). Lab LCP is 2.7 s, over the 2.5 s limit. 83% of it (2,242 ms) is render delay on the hero lead paragraph, which starts its `blur-in` animation at `opacity: 0` with a 100 ms delay.
3. `CONT-TRUST` (Medium). Browsers load the Cloudflare Web Analytics beacon, but the page does not say so. Cloudflare injects the beacon at the edge. The build has no token, so the footer leaves out its "Cookieless analytics" label.
4. `AEO-ENTITY` (Low). Three descriptions of one product: "open source SaaS starter kit for Cloudflare" (site), "Composable SaaS accelerator for Cloudflare; a CLI + module registry, not a boilerplate" (GitHub), "Composable SaaS accelerator kit." (npm).

## Findings

| ID | Area | Engine | Verdict | Evidence | Severity | Effort | Fix |
|----|------|--------|---------|----------|----------|--------|-----|
| `TECH-CWV` | Technical | both | warn | Lab, local machine, Lighthouse 12.6.1 mobile, three runs: LCP 2.7 s, 10.2 s, 2.7 s (median 2.7 s; the 10.2 s run is an outlier). CLS 0.021. TBT 150 ms, 0 ms, 10 ms (a proxy for INP). Performance 0.93, SEO 1.0. LCP element: `p.text-lead` "An open source SaaS starter kit for Cloudflare. Start small, and add each modul…". LCP phases: TTFB 475 ms, load delay 0, load time 0, render delay 2,242 ms. Main-thread work 6.8 s, of which 5,866 ms belongs to the document (Style & Layout 1,947 ms, Rendering 1,299 ms), not to script. DOM size 1,746 elements. No field data exists yet. | Medium | S | `apps/web/src/blocks/hero.tsx:86` and `:90`: take `blur-in` off the `<h1>` and the lead `<p>`, and keep the cascade on the CTA block (`:93`) and the note (`:98`). The alternative is a separate keyframe for the text that starts at `opacity: 1`, so the paint counts at once. This changes visible motion, so it goes through a mockup round per AGENTS.md (motionkit can pick the replacement). Re-run Lighthouse three times after the change. Then read field data in Search Console after 28 days of traffic. |
| `CONT-TRUST` | Content | both | warn | `curl` with `Accept-Encoding: gzip, br` gets `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/vce70…" data-cf-beacon='{"version":"2024.11.0","token":"21d836f6…","r":1,"spa":2}'>`. Uncompressed `curl` and `dist/client/index.html` have no beacon, so Cloudflare's automatic setup adds it at the edge. The footer shows "Open source · MIT license" and no analytics label, because `PUBLIC_CF_ANALYTICS_TOKEN` is unset (`apps/web/src/lib/analytics.ts`). The comment there says the page "never names a tracker it does not load". The opposite case is live: the page loads a tracker it does not name. No privacy page. | Medium | S | Pick one source for the beacon. Preferred: set `PUBLIC_CF_ANALYTICS_TOKEN` at build time to the site token (a public value), so `Layout.astro:111` writes the beacon and `footer.tsx:71` adds "Cookieless analytics". Then switch the `saasaloy.com` site in Cloudflare Web Analytics from automatic to manual setup, so the edge does not inject a second beacon. The other choice is to turn off the automatic setup and ship no analytics. |
| `CONT-DEPTH` | Content | both | warn | The closest competitor for the primary query, saasflare.dev, answers "Can I really run a SaaS on Cloudflare for $0?" with free-tier numbers (100K Worker requests per day, 5 GB D1), "I don't know Cloudflare at all", and "Do I need to use every product?". Saasaloy's FAQ covers cost and the account question, but the cost answer has no numbers. No page compares Saasaloy with the starter kits that rank for the query. | Medium | L | `landing.ts:384` ("What does it cost to host?"): add the Workers free-tier limits from Cloudflare's pricing page, with the date. Then write the comparison page in the long-term plan. |
| `OFF-PRESENCE` | Off-site | both | warn | Web search for "open source SaaS starter kit Cloudflare" on 2026-11-02: nine results (GitHub topic pages, svelteflare, agioracle/SaaSStarterKit, edgesaas-starter-kit, saasflare.dev, awesome-saas-boilerplates). No saasaloy.com and no saasaloy GitHub result. The domain is one day old, so this is a baseline, not a fault. | Medium | L | Submit the repo to `polinom/awesome-saas-boilerplates`, which ranks for the query. See "Build next" and "Keep doing". |
| `AEO-ENTITY` | AEO | ai | warn | Page and JSON-LD: "Saasaloy is an open source SaaS starter kit for Cloudflare." GitHub description: "Composable SaaS accelerator for Cloudflare; a CLI + module registry, not a boilerplate". npm description: "Composable SaaS accelerator kit.", npm homepage `https://github.com/mimukit/saasaloy#readme`. The footer links the author and the company, `https://mimukit.com/` and `https://brainaloy.com/`, and both answer `403` with `cf-mitigated: challenge` to `curl`, with a browser user agent too. That is a signal, not proof: a WAF may judge by IP. | Low | S | Use one sentence in all three places: "An open source SaaS starter kit for Cloudflare: a CLI plus a module registry that copies source files you own." Set it with `gh repo edit mimukit/saasaloy --description "…"` and in the `description` of `packages/cli/package.json`. The uncommitted `homepage: "https://saasaloy.com"` in that file reaches npm with the next release. On the mimukit.com and brainaloy.com zones, check that Bot Fight Mode or a WAF rule does not challenge verified bots and AI agents. |

Checks that pass, with their evidence:

- `CRAWL-STATUS`: 200, no redirects, 273 ms.
- `CRAWL-ROBOTS`: `robots` verdict for `/`: every agent allowed by `Allow: /` in the `*` group.
- `CRAWL-NOINDEX`: no robots meta, no `X-Robots-Tag` header.
- `CRAWL-CANON`: one canonical, `https://saasaloy.com/`, equal to the final URL. `/?utm_source=x` serves the same canonical. `/nope-xyz` answers a real 404 with `<meta name="robots" content="noindex">` and no canonical.
- `CRAWL-SITEMAP`: `robots.txt` names `https://saasaloy.com/sitemap.xml`. It parses, lists one URL, `https://saasaloy.com/`, which answers 200 and is canonical.
- `CRAWL-LINKS`: two internal links, both `<a href="https://saasaloy.com/">`, both 200. All nine GitHub links answer 200, including `tree/main/apps/web`, which was 404 in report 0001. No script-only links.
- `CRAWL-RENDER`: 1,568 words in raw HTML, the same in the rendered DOM. All nine FAQ answers sit in native `<details>` in the HTML.
- `TECH-HTTPS`: `http://saasaloy.com/` answers 301 to `https://saasaloy.com/`. No insecure resources. No `Strict-Transport-Security` header, which is a bonus and not a pass condition.
- `TECH-MOBILE`: `width=device-width, initial-scale=1`.
- `TECH-HOST`: `https://www.saasaloy.com/` and `http://www.saasaloy.com/` answer 301 to `https://saasaloy.com/`, and `www` keeps the path (`/foo?x=1`). `/index.html` and `//` answer 307 to `/`. `saasaloy.brainaloy.workers.dev` answers 404, so it splits no signals.
- `PAGE-TITLE`: "Saasaloy: an open source SaaS starter kit for Cloudflare", 56 characters.
- `PAGE-DESC`: "Saasaloy is an open source SaaS starter kit for Cloudflare. Start with a landing page, then add the API, database, auth and more as source files you own.", 153 characters.
- `PAGE-HEAD`: one H1, "A landing page today. Your next module tomorrow.", eight H2, three H3 under "Built on Cloudflare and tools you already know.". No skipped level.
- `PAGE-IMG`: no `<img>`. The drawings are inline SVG, and the LCP element is text.
- `PAGE-ANCHOR`: anchors carry their topic ("Getting started", "Read the agent guide", "Changelog"). The five stage links ("Validate", "MVP", "Teams", "Money", "Scale") use text fragments into `modules.md`.
- `PAGE-SOCIAL`: `og:title`, `og:description`, `og:url` equal to the canonical, `og:image` `https://saasaloy.com/og.png` (200, `image/png`, 1200×630, 101 KB), `og:image:alt`, `twitter:card` `summary_large_image`.
- `PAGE-INTENT`: the lead paragraph under the H1 is "An open source SaaS starter kit for Cloudflare. Start small, and add each module as source files you own." The title, the lead and the primary query use the same words.
- `DATA-PRESENT`: one `@graph` with `Organization`, `WebSite`, `SoftwareSourceCode`, found in raw HTML and in the rendered DOM.
- `DATA-VALID`: parses with no error. `Organization` has `name`, `url`, `logo`, `sameAs`. Stable `@id` values link the three nodes.
- `DATA-MATCH`: the `SoftwareSourceCode` description equals the meta description. The page shows the same facts in the hero and in the "What is Saasaloy?" FAQ answer.
- `DATA-ENTITY`: `Organization` with `sameAs` to GitHub and npm, and `logo` `https://saasaloy.com/favicon.svg` (200, `image/svg+xml`).
- `CONT-ANSWER`: the first FAQ item, "What is Saasaloy?", answers in 61 words: "an open source, composable SaaS starter kit for Cloudflare. It is a CLI plus a module registry, not a boilerplate…".
- `CONT-AUTHOR`: the footer names "Mukitul Islam Mukit" and "Brainaloy Labs". A developer tool is not a health, money or legal topic.
- `CONT-DATE`: "Version 0.8.0. Proof of concept. Not for production use yet." shows in the hero, read from `packages/cli/package.json` at build time. The changelog is linked.
- `CONT-SOURCE`: product claims link to the docs and the source.
- `AEO-BOTS`: one deliberate policy, every purpose allowed, as report 0001 proposed. It suits an open source project that wants citations, and lets assistants read the docs for a user.
- `AEO-WAF`: all eleven agent probes (Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot, PerplexityBot, ChatGPT-User, Claude-User, Perplexity-User, GPTBot, ClaudeBot, CCBot) answer 200 with 186,692 bytes and no challenge markup. The agent strings are spoofed, so this is a signal, not proof.
- `AEO-EXTRACT`: nine question-shaped FAQ headings, the stages as an ordered list, the module catalog as a list in raw HTML.
- `AEO-FILES`: `/llms.txt` answers 404. The file is optional, so absence passes. See "Build next".

## AI readiness

Bot access matrix for `/`, from the `robots` verdict and one probe per agent.

| Agent | Purpose | robots.txt rule | Probe |
|-------|---------|-----------------|-------|
| Googlebot, Bingbot | search | `Allow: /` | 200, 200 |
| OAI-SearchBot, Claude-SearchBot, PerplexityBot | AI search | `Allow: /` | 200, 200, 200 |
| ChatGPT-User, Claude-User, Perplexity-User | user retrieval | `Allow: /` | 200, 200, 200 |
| GPTBot, ClaudeBot, CCBot | training | `Allow: /` | 200, 200, 200 |
| Google-Extended, Applebot-Extended | product tokens | `Allow: /` | not probed (tokens, not crawlers) |

Extractability: good. All copy is in the raw HTML, a crawler that runs no JavaScript sees the same 1,568 words as a browser, and the FAQ now opens with a quotable definition. The gap is off-page. An engine looking for consensus finds three different product descriptions (`AEO-ENTITY`) and no third-party page that names Saasaloy (`OFF-PRESENCE`).

## Long-term plan

**Fix now** (this week):

- Commit `apps/web/astro.config.mjs` and `apps/web/wrangler.jsonc`, so the next deploy keeps `saasaloy.com` as the origin (Fix these first, item 1).
- `CONT-TRUST`: set `PUBLIC_CF_ANALYTICS_TOKEN` at build time and switch the Web Analytics site to manual setup.
- `AEO-ENTITY`: one product sentence on GitHub, npm and the site.
- `TECH-CWV`: remove the `blur-in` entry from the H1 and the lead paragraph, after a mockup round.
- Verify `saasaloy.com` in Search Console and Bing Webmaster Tools today, and submit `https://saasaloy.com/sitemap.xml` in both.

**Build next** (one to three months):

- Docs on the domain (playbook: developer sites, "static or server-rendered docs"). Every "Getting started", "Docs" and "Guide" link still goes to github.com, 20 of 22 links on the page. Docs at `saasaloy.com/docs/` would keep that authority on the domain, take `@astrojs/sitemap`, and give the site more than one indexable URL.
- Serve `/llms.txt` (playbook: developer sites, "an `llms.txt` index of the docs"). The repository root already has `llms.txt` for agents that build with Saasaloy. Publish it from `apps/web`, with links that point at the docs on the domain once they exist.
- An honest comparison page (playbook: SaaS, "comparison pages that name the category leader") for `CONT-DEPTH`. Name the kits that rank for the primary query today (saasflare.dev, svelteflare, agioracle/SaaSStarterKit) and state the difference as the module model and the swappable providers.
- One page per main module (auth, payment, queue, database driver), each with its command, its files and its providers. The catalog tiles in `landing.ts` are the seed.

**Keep doing:**

- Check Search Console and Bing Webmaster Tools monthly. Neither one reports AI answers on their own. AI Overview traffic sits inside Search Console's normal totals.
- Track AI visibility by hand. Use 10 to 20 prompts such as "open source SaaS starter kit for Cloudflare" and "how do I add auth to a Cloudflare Workers app". Run each 3 to 5 times per engine in a fresh session each month, and record a rate ("cited 2 of 5").
- Read `TECH-CWV` field data in Search Console once the domain has 28 days of traffic. Lab numbers from this box vary from 2.7 s to 10.2 s.
- Earn mentions where developers look (the awesome-saas-boilerplates list, Show HN, r/CloudFlare, dev.to), because citation sources change between model releases.
- Re-run seokit after each release that touches `Layout.astro`, `hero.tsx` or `landing.ts`.

**Do not** (from the playbooks):

- Publish a self-ranked "best SaaS starter kits" list. Answer engines cite it as a category source and then recommend the established kits.
- Make one landing page per keyword with swapped nouns.
- Block `ChatGPT-User` or `Claude-User`. Developers ask assistants to read the docs for them.
- Sell `FAQPage` markup as a Google win. Google stopped FAQ rich results on 2026-05-07.

## Since last audit

Compared with `0001-seo-saasaloy-com-2026-10-27.md`. **Environment change:** report 0001 ran on a local production build. This run is on the live site behind Cloudflare, so network time is in every timing.

- **Fixed (11):** `CRAWL-CANON`, `PAGE-INTENT`, `CONT-ANSWER`, `PAGE-SOCIAL`, `CRAWL-SITEMAP`, `DATA-PRESENT`, `DATA-ENTITY`, `AEO-BOTS`, `PAGE-DESC`, `CRAWL-LINKS`, `CONT-DATE`.
- **Still open (1):** `CONT-TRUST`. The form changed: report 0001 asked for a privacy note before the beacon ships. The beacon now loads through Cloudflare's edge, and the page still names no analytics.
- **Regressed (1):** `TECH-CWV`, from pass (lab LCP 2.3 s, local) to warn (lab LCP 2.7 s median, production). Part of the change is the environment: TTFB went from local to 475 ms. The render delay stayed the main cost in both runs.
- **New (3):** `CONT-DEPTH`, `OFF-PRESENCE`, `AEO-ENTITY`. All three read `n/a` in the local run.
- **Newly verified (3):** `TECH-HTTPS`, `TECH-HOST`, `AEO-WAF` pass. They read `n/a` in report 0001.

## Appendix

### Raw evidence

- `extract https://saasaloy.com/`: status 200, 273 ms, 187,059 bytes, `lang` "en", `content-type: text/html`, `cache-control: public, max-age=0, must-revalidate`, `xRobotsTag: null`, canonical `https://saasaloy.com/`, `h1Count` 1, `rawWordCount` 1568, links 2 internal, 20 external, 0 script-only, 1 fragment, `insecureResources: []`.
- `extract --html` on the rendered DOM (Chromium 1247, 187,196 bytes): 1568 words, 1 H1, JSON-LD types `Organization`, `WebSite`, `SoftwareSourceCode`.
- `robots.txt` (200, `text/plain`, 66 bytes): `User-agent: *` / `Allow: /` / `Sitemap: https://saasaloy.com/sitemap.xml`.
- `sitemap.xml` (200, `application/xml`): one `<loc>https://saasaloy.com/</loc>`.
- `/llms.txt`: 404. `/og.png`: 200, 1200×630. `/favicon.svg`: 200.
- Host variants: `http://saasaloy.com/` 301, `http://www.saasaloy.com/` 301, `https://www.saasaloy.com/` 301, all to `https://saasaloy.com/`. `/index.html` 307, `//` 307. `https://saasaloy.brainaloy.workers.dev/` 404.
- Beacon: present only on a compressed response (`Accept-Encoding: gzip, br`). Absent from an uncompressed response and from `apps/web/dist/client/index.html`.
- PageSpeed Insights API: HTTP 429, "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'". Manual check: <https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fsaasaloy.com%2F>.
- Lighthouse 12.6.1 from the repository's `node_modules/.pnpm`, mobile profile, headless Chromium 1247, three runs from devaloy. Lab data, not field data. Unused JavaScript: `/_astro/client.B0tx6T-r.js`, 41 KiB estimated saving. Render-blocking: `/_astro/Layout.VED5dLe4.css`, 182 ms.

### Sources

- Core Web Vitals thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1 at p75): <https://web.dev/articles/vitals>, read 2026-11-02.
- FAQ rich results ended on 2026-05-07: seokit's structured-data reference, citing Google Search Central, as of 2026-10.
- Competitor FAQ and free-tier numbers: <https://saasflare.dev/>, fetched 2026-11-02.
- Search results for "open source SaaS starter kit Cloudflare": web search, 2026-11-02. Results included <https://github.com/topics/saas-starter-kit>, <https://github.com/agioracle/SaaSStarterKit>, <https://github.com/pinebasedev/svelteflare>, <https://github.com/polinom/awesome-saas-boilerplates>, <https://github.com/MilindChatrabhuji/edgesaas-starter-kit>, <https://saasflare.dev/starter>.
