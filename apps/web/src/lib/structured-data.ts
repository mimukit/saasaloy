// The home page's JSON-LD: one `@graph` that names the project as an `Organization`, the
// site as a `WebSite`, the code as `SoftwareSourceCode`, and the visible FAQ as an
// `FAQPage`. Answer engines read it to tie the name, the repository and the npm package
// to one entity, and to lift each answer whole.
//
// No `SoftwareApplication`: Google shows that rich result only with `aggregateRating` or
// `review`, and the project has neither. Google shows no FAQ rich result for this site,
// but Bing and the AI answer engines still read `FAQPage`. Every claim here must also be
// on the page.

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
  /** The FAQ as the page renders it: placeholders filled, backticks kept as written. */
  faq: { question: string; answer: string }[];
  /** The build's commit date as `YYYY-MM-DD`. Omitted when the build has no git. */
  dateModified?: string;
}

/** The JSON-LD object for the home page. Layout.astro serializes it. */
export function homeGraph({
  site,
  siteName,
  description,
  locale,
  faq,
  dateModified,
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
        ...(dateModified ? { dateModified } : {}),
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        url: home,
        inLanguage: locale,
        isPartOf: { "@id": `${home}#website` },
        about: { "@id": `${home}#software` },
        mainEntity: faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: {
            "@type": "Answer",
            // The page renders backticks as <code>; plain text drops them.
            text: answer.replaceAll("`", ""),
          },
        })),
      },
    ],
  };
}
