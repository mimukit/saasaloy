// The home page's JSON-LD: one `@graph` that names the project as an `Organization`, the
// site as a `WebSite`, and the code as `SoftwareSourceCode`. Answer engines read it to
// tie the name, the repository and the npm package to one entity.
//
// No `SoftwareApplication`: Google shows that rich result only with `aggregateRating` or
// `review`, and the project has neither. No `FAQPage`: Google stopped FAQ rich results,
// and the visible FAQ is already in the HTML. Every claim here must also be on the page.

import { repoUrl } from "@web/site";

const REPO = repoUrl;
const NPM = "https://www.npmjs.com/package/saasaloy";

interface HomeGraphInput {
  /** `Astro.site`, the public origin. */
  site: URL;
  siteName: string;
  /** The page's meta description, already interpolated. */
  description: string;
  /** The BCP 47 tag the page declares. */
  locale: string;
}

/** The JSON-LD object for the home page. Layout.astro serializes it. */
export function homeGraph({
  site,
  siteName,
  description,
  locale,
}: HomeGraphInput) {
  const home = new URL("/", site).href;
  const organization = `${home}#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization,
        name: siteName,
        url: home,
        logo: new URL("/favicon.svg", site).href,
        sameAs: [REPO, NPM],
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: siteName,
        inLanguage: locale,
        publisher: { "@id": organization },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${home}#software`,
        name: siteName,
        description,
        codeRepository: REPO,
        programmingLanguage: "TypeScript",
        license: `${REPO}/blob/main/LICENSE.md`,
        author: { "@id": organization },
      },
    ],
  };
}
