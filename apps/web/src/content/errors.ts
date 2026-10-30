// Every word an error screen shows, in one file.
//
// The words the landing page shows live next door in ./landing.ts, and that file's
// preamble states the five shape rules — max three levels, stable ids over positions,
// single-brace `{token}` placeholders, no runtime concatenation, user-visible strings
// only. They apply here unchanged; read them there rather than trusting a summary.
//
// WHY THIS IS A SECOND FILE. A copy pass rewrites the marketing voice and never reaches
// an error screen, so keeping these strings out of `landing.*` means a rewrite cannot
// leave a 404 page speaking in the old voice. A translation pass walks both files.
//
// ONE NAMESPACE, TWO CASES, split by what failed:
//
//   notFound       Nothing lives at this address. src/pages/404.astro reads it.
//   serverFailure  The server failed while producing the page. src/pages/500.astro
//                  reads it.
//
// The `code` values are display labels, not a claim about the HTTP status the response
// carried.
//
// No `{siteName}` token appears below, deliberately. An error screen is the one surface
// where naming the product adds nothing: the reader already knows where they are, and a
// brand name in a failure message reads as deflection.

/** Copy for the two error screens ../blocks/error-state.tsx renders. */
export const errors = {
  notFound: {
    code: "404",
    title: "This page does not exist",
    description:
      "The address may have a typo, or the page may have moved since the link was written. Nothing is lost — start again from the home page.",
    homeLabel: "Back to home",
  },

  serverFailure: {
    code: "500",
    title: "Something went wrong on our side",
    description:
      "The page could not be produced. This is not something you did. Try again in a moment.",
    // No `retryLabel`. The 500 page is prerendered, so a retry button would reload the
    // same static file and could not re-run whatever failed; src/pages/500.astro says so
    // at length.
    homeLabel: "Back to home",
  },
};
