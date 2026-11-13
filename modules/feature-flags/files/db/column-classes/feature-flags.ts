import { defineColumnClasses } from "../column-class";
import { featureFlags as featureFlagsTable } from "../schema/feature-flags";

// How the production read-only role reads `feature_flags`. See `../column-class.ts`.

export const featureFlags = defineColumnClasses(featureFlagsTable, {
  createdAt: "plain",
  description: "plain",
  enabled: "plain",
  id: "plain",
  key: "plain",
  percentage: "plain",
  type: "plain",
  updatedAt: "plain",
});
