import { verifications as verificationsTable } from "../../schema/auth";
import { defineSlice } from "../slice";

// Empty on purpose. A verification row is a short-lived token Better Auth writes during a
// flow, such as an email check, and a seeded one would already be expired or unusable.

export const verifications = defineSlice(verificationsTable, { rows: {} });
