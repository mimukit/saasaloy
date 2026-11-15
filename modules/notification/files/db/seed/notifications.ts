import { notifications as notificationsTable } from "../../schema/notifications";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One row for each state the bell, the menu and the page show differently: unread and
// read, in both shipped categories, with and without a body and a link. They belong to
// the `member` seed user, so signing in as `member@example.test` shows a badge of 2.
//
// `admin@example.test` gets one unread row, so a second user always has rows of their own
// and a test can prove neither sees the other's.
//
// The dates are fixed, as every other slice's are. A prune run on a seeded database deletes
// the read rows, since they are older than `readRetentionDays`; `pnpm db:seed` brings them
// back.

const at = (day: number) =>
  new Date(`2026-01-${String(day).padStart(2, "0")}T09:00:00.000Z`);
const member = seedId("users", "member");
const admin = seedId("users", "admin");

export const notifications = defineSlice(notificationsTable, {
  rows: {
    "member-account-unread": {
      body: "A new sign-in from Firefox on Linux. If this was not you, change your password.",
      category: "account",
      createdAt: at(5),
      href: "/",
      title: "New sign-in to your account",
      userId: member,
    },
    "member-product-unread": {
      category: "product",
      createdAt: at(4),
      title: "Your export is ready",
      userId: member,
    },
    "member-account-read": {
      category: "account",
      createdAt: at(3),
      readAt: at(3),
      title: "Your email address was verified",
      userId: member,
    },
    "member-product-read": {
      body: "Search now matches words inside a project's description.",
      category: "product",
      createdAt: at(2),
      readAt: at(2),
      title: "New: better search",
      userId: member,
    },
    "admin-account-unread": {
      category: "account",
      createdAt: at(5),
      title: "You were made an admin",
      userId: admin,
    },
  },
});
