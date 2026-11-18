import { defineSection } from "@repo/config/define";

// `api-keys`'s config section. Read it as `config["api-keys"]`: the key is the module
// name, and a hyphen in a key needs the bracket form.
//
// Until #162 the ceiling below was a literal inside the create form, and the server took
// Better Auth's own default. One leaf now feeds both, so the form cannot offer a date the
// server refuses. Change it in `packages/config/src/project.ts`.

/** The `api-keys` section. Override it in `packages/config/src/project.ts`. */
export function apiKeysConfig() {
  return defineSection("api-keys", {
    /**
     * The longest expiry, in days, a key may be created with. The plugin refuses a longer
     * `expiresIn` (`keyExpiration.maxExpiresIn`), and the create form caps its input here.
     * A key created with no expiry is not affected: it stays valid until it is revoked.
     *
     * What a change costs: a key is a bearer credential, so a longer ceiling lets a leaked
     * key work for longer before it lapses on its own. A shorter one makes an operator
     * rotate deploy keys more often, and it applies only to keys created after the
     * change. A whole number of days, at least 1, the plugin's floor.
     */
    maxExpiryDays: 365,
  });
}
