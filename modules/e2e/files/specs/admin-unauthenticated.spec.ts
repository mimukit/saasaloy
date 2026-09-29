import { expect, test } from "@playwright/test";

import { URLS } from "../lib/project.ts";

// The negative case, and its own flow rather than a second assertion inside the login spec.
//
// An authorization regression shows up exactly here. The admin SPA's root guard runs in the
// browser, so it hides a server that stopped checking: every screen would still look right
// while `GET /admin/users` answered 200 to anyone who asked. This spec asks with no cookie
// at all, so nothing but `requireAdmin` can produce the refusal.
//
// It uses `request`, not `page`. A browser context carries whatever the run left in it; a
// fresh request context is the only way to be sure the call really is anonymous.
test.describe("admin, unauthenticated", { tag: ["@admin", "@auth"] }, () => {
  test("the guarded api route refuses a caller with no session", async ({
    playwright,
  }) => {
    const anonymous = await playwright.request.newContext();
    try {
      const response = await anonymous.get(`${URLS.api}/admin/users`, {
        failOnStatusCode: false,
      });

      // 401, not 403. Nobody is signed in, so signing in is the thing that would help, and
      // that is the distinction `packages/auth/src/authorize.ts` makes.
      expect(response.status()).toBe(401);
      // api's `onError` renders one envelope for every refusal. A route that answered a
      // bare string here would break every client's error handling.
      expect(await response.json()).toMatchObject({
        error: { code: "unauthorized" },
      });
    } finally {
      await anonymous.dispose();
    }
  });
});
