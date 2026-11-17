import { defineColumnClasses } from "../column-class";
import { notificationOptOuts as notificationOptOutsTable } from "../schema/notifications";

// How the production read-only role reads `notification_opt_outs`. See `../column-class.ts`.

export const notificationOptOuts = defineColumnClasses(
  notificationOptOutsTable,
  {
    category: "plain",
    createdAt: "plain",
    userId: "plain",
  }
);
