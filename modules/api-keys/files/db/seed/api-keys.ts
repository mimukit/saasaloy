import { apiKeys as apiKeysTable } from "../../schema/api-keys";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One `acme` key for each state the keys page shows: active and disabled.
//
// No expired key. Better Auth deletes every expired key whenever an api-key endpoint
// runs (`deleteAllExpiredApiKeys`), so a seeded one is gone the first time the page lists
// the keys. Create a key with a short expiry on the page to see that state.
//
// `key` holds a hash, as Better Auth stores it, of a secret nobody has. These rows fill the
// list; they cannot authenticate a request. Create a key on the page to call the api.

const CREATED = new Date("2026-01-01T00:00:00.000Z");

function apiKey(name: string, start: string) {
  return {
    configId: "default",
    createdAt: CREATED,
    key: `seed-hash-${start}`,
    name,
    organizationId: seedId("organizations", "acme"),
    permissions: JSON.stringify({ project: ["read"] }),
    prefix: "sk_",
    rateLimitEnabled: false,
    start: `sk_${start}`,
  };
}

export const apiKeys = defineSlice(apiKeysTable, {
  rows: {
    active: { ...apiKey("Deploy pipeline", "act1ve"), enabled: true },
    disabled: { ...apiKey("Old integration", "d1sabl"), enabled: false },
  },
});
