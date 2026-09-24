import { expect, test } from "@playwright/test";

import { uniqueEmail } from "../lib/fixtures.ts";
import { URLS } from "../lib/project.ts";

// The public form flow, end to end: a real browser fills the real form on `apps/web`, the
// island posts to the api Worker, the route writes the row, and the panel swaps to its
// success state.
//
// **This flow needs the block to be on a page.** `saasaloy add waitlist` writes the block
// and the island and then stops; placing it is your call, and the `saasaloy-waitlist`
// skill's Wire-up section carries the two lines. The assertion below says so when the form
// is missing, rather than skipping — a skip would report green for a project whose waitlist
// nobody can reach.
test.describe("waitlist", { tag: ["@waitlist"] }, () => {
  test("a visitor joins the waitlist from the landing page", async ({
    page,
  }) => {
    // A fresh address every run. Nothing to delete afterwards, so a crashed run cannot
    // leave the next one a row to trip over. See `lib/fixtures.ts`.
    const email = uniqueEmail("waitlist");

    await page.goto(URLS.web);

    const field = page.getByLabel("Email", { exact: true });
    await expect(
      field,
      "The waitlist form is not on the landing page. Place it: see the Wire-up section of the saasaloy-waitlist skill."
    ).toBeVisible();

    // WAIT FOR HYDRATION BEFORE TYPING. The form is a React island on a static Astro page,
    // so the input is in the server-rendered HTML long before React owns it. A value typed
    // into that window is thrown away the moment hydration mounts the controlled input with
    // its own empty state, and the form then submits an empty address — a 400 that looks
    // like a validation bug and is really a race.
    //
    // Astro marks an island `<astro-island ssr>` until it hydrates and removes the attribute
    // after. Waiting for the one island holding this field is the exact signal; waiting for
    // every island on the page would never finish, because a `client:visible` island below
    // the fold does not hydrate until it is scrolled to. Any spec that types into an island
    // needs this line.
    await expect(
      page.locator("astro-island[ssr]").filter({ has: field })
    ).toHaveCount(0);

    await field.fill(email);
    await expect(field).toHaveValue(email);

    // Watch the POST rather than reading the row back: `apps/api` serves no GET for the
    // waitlist, on purpose, because an endpoint that answers "is this address on the list"
    // leaks membership. The route answers 201 only after the insert, so the status is the
    // proof the row exists.
    const posted = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${URLS.api}/waitlist`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Join the waitlist" }).click();

    const response = await posted;
    expect(
      response.status(),
      `The api refused the submission: ${await response.text()}`
    ).toBe(201);
    await expect(page.getByRole("status")).toContainText("on the list");
  });
});
