import { featureFlags as featureFlagsTable } from "../../schema/feature-flags";
import { defineSlice } from "../slice";

// One row for each state the flags page shows: a boolean that is off, a kill switch that
// is on and a kill switch that is thrown. The database generates `id`, so the slice
// upserts on `key`.
//
// Only registered flags get a row. The page and the api list `flags.flags` from
// `packages/feature-flags`, so a row for any other key is never shown. No flag that the
// module registers is a percentage flag; register one in your project, then add its row
// here with `type: "percentage"` and a `percentage`.
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
  },
});
