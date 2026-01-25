/**
 * Seeding script for the database.
 * Run with: pnpm db:seed
 */
async function main() {
  console.log("🌱 Starting database seeding...");

  // Example usage:
  // import { db } from "./providers/drizzle/client";
  // import * as schema from "./providers/drizzle/schema/index";
  // await db.insert(schema.users).values({ ... });

  console.log("✅ Seeding completed!");
}

main().catch((error) => {
  console.error("❌ Seeding failed:");
  console.error(error);
  process.exit(1);
});
