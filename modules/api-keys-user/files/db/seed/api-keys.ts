import { apiKeys as apiKeysTable } from "../../schema/api-keys";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Two keys owned by the seeded `member` user, one for each state a key has: active and
// disabled.
//
// No expired key. Better Auth deletes every expired key whenever an api-key endpoint
// runs (`deleteAllExpiredApiKeys`), so a seeded one is gone the first time the keys are
// listed.
//
// No scope. `API_KEY_SCOPES` ships empty, so a seeded scope would name a pair the project
// has not declared. A key with no scope passes `requireCaller` and fails every
// `requireScope`.
//
// `key` holds a hash, as Better Auth stores it, of a secret nobody has. These rows fill the
// table; they cannot authenticate a request. Create a key through the api to call it.

const CREATED = new Date("2026-01-01T00:00:00.000Z");

function apiKey(name: string, start: string) {
  return {
    configId: "default",
    createdAt: CREATED,
    key: `seed-hash-${start}`,
    name,
    prefix: "sk_",
    rateLimitEnabled: false,
    start: `sk_${start}`,
    userId: seedId("users", "member"),
  };
}

export const apiKeys = defineSlice(apiKeysTable, {
  rows: {
    active: { ...apiKey("Personal script", "act1ve"), enabled: true },
    disabled: { ...apiKey("Old laptop", "d1sabl"), enabled: false },
  },
});
