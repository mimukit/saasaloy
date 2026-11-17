import { defineColumnClasses } from "../column-class";
import { apiKeys as apiKeysTable } from "../schema/api-keys";

// How the production read-only role reads `api_keys`. See `../column-class.ts`.

export const apiKeys = defineColumnClasses(apiKeysTable, {
  configId: "plain",
  createdAt: "plain",
  enabled: "plain",
  expiresAt: "plain",
  id: "plain",
  // The key hash a bearer call is checked against.
  key: "secret",
  lastRefillAt: "plain",
  lastRequest: "plain",
  metadata: "plain",
  name: "plain",
  permissions: "plain",
  prefix: "plain",
  rateLimitEnabled: "plain",
  rateLimitMax: "plain",
  rateLimitTimeWindow: "plain",
  refillAmount: "plain",
  refillInterval: "plain",
  remaining: "plain",
  requestCount: "plain",
  start: "plain",
  updatedAt: "plain",
  userId: "plain",
});
