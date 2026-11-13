import { defineColumnClasses } from "../column-class";
import { featureFlagOverrides as featureFlagOverridesTable } from "../schema/feature-flags";

// How the production read-only role reads `feature_flag_overrides`. See `../column-class.ts`.

export const featureFlagOverrides = defineColumnClasses(
  featureFlagOverridesTable,
  {
    createdAt: "plain",
    enabled: "plain",
    flagKey: "plain",
    id: "plain",
    percentage: "plain",
    tenantId: "plain",
    updatedAt: "plain",
  }
);
