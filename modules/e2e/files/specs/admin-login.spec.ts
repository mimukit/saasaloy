import { expect, test } from "@playwright/test";

import { TEST_USER, URLS } from "../lib/project.ts";

// The authenticated flow, driven through the real login form.
//
// It deliberately ignores the `storageState` that `auth.setup.ts` saved. A login flow that
// starts from a cookie tests the cookie, not the login: the form, the better-auth call, the
// CORS allowlist, the session write and the root guard's redirect are exactly what this
// covers. A later spec of yours can opt into the saved state instead —
// `test.use({ storageState: STORAGE_STATE })`.
test.describe("admin login", { tag: ["@admin", "@auth"] }, () => {
  test("an admin signs in and opens a guarded screen", async ({ page }) => {
    await page.goto(`${URLS.admin}/login`);

    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The root guard sends a signed-in admin away from /login. Anything else — staying put,
    // or bouncing back — is a failure, so assert the destination rather than the absence of
    // an error message.
    await expect(page).toHaveURL(`${URLS.admin}/`);

    // The denied panel renders INSIDE the shell, so "signed in and redirected" is not proof
    // of anything on its own.
    await expect(
      page.getByText("This account cannot open the admin app")
    ).toBeHidden();

    // `GET /admin/users` is the guarded call, and watching it is what separates "the SPA let
    // me in" from "the server agreed". The root guard runs in the browser and could pass on
    // its own while `requireAdmin` on the api refuses.
    const guarded = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${URLS.api}/admin/users`) &&
        response.request().method() === "GET"
    );
    await page.getByRole("link", { name: "Users" }).click();

    const listed = await guarded;
    expect(listed.status()).toBe(200);
    // The screen rendered its own data, not an error boundary.
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
  });
});
