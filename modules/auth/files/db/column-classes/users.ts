import { defineColumnClasses } from "../column-class";
import { users as usersTable } from "../schema/auth";

// How the production read-only role reads `users`. See `../column-class.ts`.

export const users = defineColumnClasses(usersTable, {
  createdAt: "plain",
  // The person's email.
  email: "pii",
  emailVerified: "plain",
  id: "plain",
  // A URL to the person's picture.
  image: "pii",
  // The person's name.
  name: "pii",
  updatedAt: "plain",
  role: "plain",
  banned: "plain",
  // Free text an admin wrote about the person.
  banReason: "pii",
  banExpires: "plain",
});
