import { cmsRedirects as cmsRedirectsTable } from "../../schema/cms";
import { defineSlice } from "../slice";

// No redirects: neither seeded post has changed its live slug. A row appears when a publish
// renames a live post.

export const cmsRedirects = defineSlice(cmsRedirectsTable, { rows: {} });
