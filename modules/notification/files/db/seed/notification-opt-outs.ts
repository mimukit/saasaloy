import { notificationOptOuts as notificationOptOutsTable } from "../../schema/notifications";
import { defineSlice } from "../slice";

// Empty on purpose: every seed user starts with every category on, which is what a new
// account gets. Turn a category off on the Preferences tab to see the other state.

export const notificationOptOuts = defineSlice(notificationOptOutsTable, {
  rows: {},
});
