import { discoverServices } from "./src/discover.js";
import { pushSecrets } from "./src/secrets.js";
import { toResources } from "./src/translate.js";

// `infra`'s Pulumi program (ADR 0021). Nothing here is hand-maintained per capability:
// discovery walks every service's wrangler.jsonc, and translation turns whatever
// bindings each one declares into Cloudflare resources. Drop a new service's
// wrangler.jsonc and it shows up on the next `pulumi preview`/`up` with no edit to this
// file. Secrets are pushed separately, straight to the Cloudflare API — never through
// Pulumi state (see src/secrets.ts).

const accountId = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID;
if (!accountId) {
  throw new Error(
    "infra: CLOUDFLARE_DEFAULT_ACCOUNT_ID is not set — see the saasaloy-infra skill's " +
      "credentials setup before running preview/deploy."
  );
}

const services = await discoverServices();

if (services.length === 0) {
  console.log(
    "infra: no service wrangler.jsonc found under apps/ or packages/ — nothing to deploy yet."
  );
}

const deployed = await Promise.all(
  services.map(async (service) => {
    const { script } = await toResources(service, accountId);
    await pushSecrets(service);
    return [service.name, script.scriptName] as const;
  })
);

// Stack outputs — one Cloudflare script name per deployed service. Combine with the
// account's workers.dev subdomain (Cloudflare dashboard, or `wrangler deployments
// list`) for the live URL; see the saasaloy-infra skill.
export const scripts = Object.fromEntries(deployed);
