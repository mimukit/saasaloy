import { featureFlags as featureFlagsTable } from "../../schema/feature-flags";
import { defineSlice } from "../slice";

// One flag for each state the flags page shows: a boolean that is off, a kill switch that
// is on, a kill switch that is thrown, and a percentage rollout. The database generates
// `id`, so the slice upserts on `key`.
//
// `system.maintenance` stays off. Turning it on here would put every seeded database
// behind the maintenance page.

export const featureFlags = defineSlice(featureFlagsTable, {
  key: ["key"],
  rows: {
    maintenance: {
      enabled: false,
      key: "system.maintenance",
      type: "boolean",
    },
    "kill-payments": { enabled: true, key: "kill.payments", type: "boolean" },
    "kill-ai": { enabled: false, key: "kill.ai", type: "boolean" },
    rollout: {
      description: "Seeded example of a percentage rollout.",
      enabled: true,
      key: "ui.new-dashboard",
      percentage: 25,
      type: "percentage",
    },
  },
});
