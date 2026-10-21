import { sessions as sessionsTable } from "../../schema/auth";
import { defineSlice } from "../slice";

// Empty on purpose. A session is made by signing in, and a seeded one would carry a token
// nobody holds. The slice records that choice, and the completeness test sees it.

export const sessions = defineSlice(sessionsTable, { rows: {} });
