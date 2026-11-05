import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { URLS } from "../lib/project.ts";
import { smsCode, smsMark, uniquePhone } from "../lib/sms.ts";

// The phone account's whole life, driven through the real screens on `apps/app` with the
// codes the console SMS provider prints: sign up with a code, set the first password, sign
// out, sign in, sign out, reset the password with a code, and sign in with the new one.
//
// It needs `SMS_PROVIDER=console` in `apps/api/.env`: `lib/sms.ts` reads each code from the
// api's log, and refuses to run under any other provider. The send limits are off under
// `console`, so the two codes this flow asks for never wait on the resend clock.

const FIRST_PASSWORD = "e2e-phone-first-pass";
const NEW_PASSWORD = "e2e-phone-second-pass";

/**
 * Type the number and make sure it stays. A screen mounts its form after the root guard's
 * session check, and remounts it when the number in the URL changes, so a value typed in
 * that window can be dropped. Fill until the field holds it.
 */
async function fillPhone(page: Page, phone: string): Promise<void> {
  const field = page.getByLabel("Phone number");
  await expect(field).toBeEditable();
  await expect(async () => {
    await field.fill(phone);
    await expect(field).toHaveValue(phone, { timeout: 500 });
  }).toPass();
}

/**
 * Wait for the code `phone` was sent after `mark`, and submit it. The field is cleared by
 * key presses rather than `fill`, so a code left from an earlier try never mixes with the
 * new one.
 */
async function enterCode(
  page: Page,
  phone: string,
  mark: number
): Promise<void> {
  const code = await smsCode(phone, mark);
  const field = page.getByLabel("Code", { exact: true });
  await field.focus();
  await field.press("End");
  for (const _ of code) {
    await field.press("Backspace");
  }
  await field.pressSequentially(code);
  await expect(field).toHaveValue(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Fill the new password step and save it. */
async function choosePassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("New password").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

/** Sign out from the account menu. The app lands on its sign-in route. */
async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(new RegExp(`^${URLS.app}/sign-in`));
}

/** Sign in on `/phone/sign-in` with the number and a password. */
async function signIn(
  page: Page,
  phone: string,
  password: string
): Promise<void> {
  await page.goto(`${URLS.app}/phone/sign-in`);
  await fillPhone(page, phone);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe(
  "phone account journey",
  { tag: ["@app", "@auth-phone", "@sms-console"] },
  () => {
    test("a customer signs up, signs in and resets the password by phone", async ({
      page,
    }) => {
      // A number no other run used. Nothing to delete afterwards; see `lib/sms.ts`.
      const phone = uniquePhone();

      // Sign up: the number, the code, then the first password. The app opens on home.
      await page.goto(`${URLS.app}/phone/sign-up`);
      await fillPhone(page, phone);
      const signUpMark = smsMark();
      await page.getByRole("button", { name: "Send code by SMS" }).click();
      await enterCode(page, phone, signUpMark);
      await choosePassword(page, FIRST_PASSWORD);
      await expect(page).toHaveURL(`${URLS.app}/`);
      await signOut(page);

      // Sign in with the first password.
      await signIn(page, phone, FIRST_PASSWORD);
      await expect(page).toHaveURL(`${URLS.app}/`);
      await signOut(page);

      // Reset: the number, the code, then the new password. The reset screen signs the
      // customer in with it and opens home.
      await page.goto(`${URLS.app}/phone/reset`);
      await fillPhone(page, phone);
      const resetMark = smsMark();
      await page.getByRole("button", { name: "Send code by SMS" }).click();
      await enterCode(page, phone, resetMark);
      await choosePassword(page, NEW_PASSWORD);
      await expect(page).toHaveURL(`${URLS.app}/`);
      await signOut(page);

      // The old password no longer opens the account, and the new one does.
      await signIn(page, phone, FIRST_PASSWORD);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`^${URLS.app}/phone/sign-in`));
      await signIn(page, phone, NEW_PASSWORD);
      await expect(page).toHaveURL(`${URLS.app}/`);
    });
  }
);
