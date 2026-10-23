import { expect, test } from "@playwright/test";

import { SEED_ADMIN, URLS } from "../lib/project.ts";

// The authenticated flow, driven through the real login form as the seeded superadmin.
//
// It starts from no cookie on purpose. A login flow that starts from a saved session tests
// the session, not the login: the form, the better-auth call, the CORS allowlist, the
// session write and the root guard's redirect are exactly what this covers.
test.describe("admin login", { tag: ["@admin", "@auth"] }, () => {
  test("an admin signs in and opens a guarded screen", async ({ page }) => {
    await page.goto(`${URLS.admin}/login`);

    await page.getByLabel("Email").fill(SEED_ADMIN.email);
    await page.getByLabel("Password").fill(SEED_ADMIN.password);

    // `GET /admin/users` is the guarded call, and watching it is what separates "the SPA let
    // me in" from "the server agreed". The root guard runs in the browser and could pass on
    // its own while `requireAdmin` on the api refuses. The overview at `/` makes that call
    // as soon as the guard lets the admin in, so the wait starts before the click.
    const guarded = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${URLS.api}/admin/users`) &&
        response.request().method() === "GET"
    );
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

    const listed = await guarded;
    expect(listed.status()).toBe(200);

    // The worked example screen renders that data, not an error boundary.
    await page.getByRole("link", { name: "Users" }).first().click();
    await expect(page).toHaveURL(`${URLS.admin}/users`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("cell", { name: SEED_ADMIN.email })
    ).toBeVisible();
  });
});
