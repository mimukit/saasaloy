import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test as setup } from "@playwright/test";

import { STORAGE_STATE, TEST_USER, URLS } from "./lib/project.ts";

// The suite's one seeded account, created over HTTP against the running api.
//
// This is a Playwright SETUP PROJECT, not a `globalSetup` hook, and that is the whole
// reason it works: a project runs after `webServer` has answered, so the api is up when the
// first request goes out. The database half runs earlier, in `prepare-db.ts`, because it has
// to happen before the api Worker boots. See the `saasaloy-e2e` skill.
//
// `playwright.config.ts` adds this project only when `auth` is installed, so a project
// without it never reaches this file.
//
// The email is FIXED. A unique address per run would pile up dead accounts in a database a
// developer keeps between runs, and it would make the "first user wins superadmin" rule fire
// for a different row every time. A sign-up that is refused because the account already
// exists is the expected second-run path, so this signs in instead.

// better-auth refuses a request that carries no `Origin`, so a bare `request.post` gets a
// 403 `MISSING_OR_NULL_ORIGIN` rather than an account. A browser always sends one; an API
// request context does not. Send the admin app's origin, which `trustedOrigins` in
// `packages/auth/src/auth.ts` already allows, so this seeding goes through the same check a
// real sign-in does.
const ORIGIN = { Origin: URLS.admin };

setup("seed the fixture admin account", async ({ request }) => {
  const signUp = await request.post(`${URLS.api}/auth/sign-up/email`, {
    headers: ORIGIN,
    data: {
      name: TEST_USER.name,
      email: TEST_USER.email,
      password: TEST_USER.password,
    },
    failOnStatusCode: false,
  });

  if (!signUp.ok()) {
    // Already there, from a previous run against the same database. Prove the credentials
    // still work rather than assuming: a 4xx for any other reason has to fail here, where
    // the message names the api, and not four specs later as a login that will not submit.
    const signIn = await request.post(`${URLS.api}/auth/sign-in/email`, {
      headers: ORIGIN,
      data: { email: TEST_USER.email, password: TEST_USER.password },
      failOnStatusCode: false,
    });
    expect(
      signIn.ok(),
      `Could not create or sign in ${TEST_USER.email}. Sign-up answered ${signUp.status()}, sign-in answered ${signIn.status()}: ${await signIn.text()}`
    ).toBe(true);
  }

  // The fixture has to be an admin, and the api grants that to the FIRST account on an empty
  // `users` table. A database that already held an account gives this one the plain `user`
  // role, and `admin-login.spec.ts` would then land on the denied panel. Say so here, where
  // the fix ("drop the database and run again") is obvious.
  const session = await request.get(`${URLS.api}/auth/get-session`, {
    headers: ORIGIN,
  });
  expect(session.ok(), "The api did not answer /auth/get-session.").toBe(true);
  const body = (await session.json()) as {
    user?: { role?: string | null };
  } | null;
  const role = body?.user?.role ?? "";
  expect(
    ["admin", "superadmin"],
    `${TEST_USER.email} has the role "${role}". The api grants superadmin to the first account only, so this database already held one. Run pnpm db:drop, then pnpm e2e.`
  ).toContain(role);

  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await request.storageState({ path: STORAGE_STATE });
});
