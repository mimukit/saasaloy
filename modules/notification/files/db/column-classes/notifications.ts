import { defineColumnClasses } from "../column-class";
import { notifications as notificationsTable } from "../schema/notifications";

// How the production read-only role reads `notifications`. See `../column-class.ts`.

export const notifications = defineColumnClasses(notificationsTable, {
  category: "plain",
  // The second line shown to the person, which can name them or someone else.
  body: "pii",
  createdAt: "plain",
  href: "plain",
  id: "plain",
  readAt: "plain",
  // The line shown to the person, which can name them or someone else.
  title: "pii",
  userId: "plain",
});
