import { expect, test } from "@playwright/test";

import { URLS } from "../lib/project.ts";

// The floor. It needs nothing but `api`, so it is the one flow every project with this
// suite runs, and a red here means the Worker did not start rather than that a feature
// broke.
//
// The tag names the module this flow needs. `playwright.config.ts` turns every tag whose
// module is absent into `grepInvert`, so a spec is never collected rather than skipped at
// runtime. See `lib/project.ts` for the tag vocabulary.
test.describe("health", { tag: ["@api"] }, () => {
  test("the api answers GET /health with the documented body", async ({
    request,
  }) => {
    const response = await request.get(`${URLS.api}/health`);

    expect(response.status()).toBe(200);
    // The exact body, not a loose `toHaveProperty`. This route's shape is what
    // `hc<AppType>` hands every caller, so a field added here is a contract change and
    // should fail until somebody decides it is wanted.
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
