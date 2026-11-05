import { defineColumnClasses } from "../column-class";
import { accounts as accountsTable } from "../schema/auth";

// How the production read-only role reads `accounts`. See `../column-class.ts`.

export const accounts = defineColumnClasses(accountsTable, {
  // An OAuth access token.
  accessToken: "secret",
  accessTokenExpiresAt: "plain",
  accountId: "plain",
  createdAt: "plain",
  id: "plain",
  // An OAuth ID token.
  idToken: "secret",
  // The password hash.
  password: "secret",
  providerId: "plain",
  // An OAuth refresh token.
  refreshToken: "secret",
  refreshTokenExpiresAt: "plain",
  scope: "plain",
  updatedAt: "plain",
  userId: "plain",
});
