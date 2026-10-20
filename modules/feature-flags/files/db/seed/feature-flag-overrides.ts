import { featureFlagOverrides as featureFlagOverridesTable } from "../../schema/feature-flags";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Two overrides of the rollout flag: one tenant forced on, one forced off. The tenant ids
// are the `teams` seed organizations' ids; nothing checks them, because `tenant_id` has no
// foreign key. The database generates `id`, so the slice upserts on the unique pair.

export const featureFlagOverrides = defineSlice(featureFlagOverridesTable, {
  key: ["flagKey", "tenantId"],
  rows: {
    "acme-on": {
      enabled: true,
      flagKey: "ui.new-dashboard",
      tenantId: seedId("organizations", "acme"),
    },
    "globex-off": {
      enabled: false,
      flagKey: "ui.new-dashboard",
      tenantId: seedId("organizations", "globex"),
    },
  },
});
