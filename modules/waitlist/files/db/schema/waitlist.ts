import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const waitlist = sqliteTable("waitlist", {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  email: text("email").notNull().unique(),
  id: integer("id").primaryKey({ autoIncrement: true }),
});
