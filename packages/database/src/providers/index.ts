import { DrizzleProvider } from "./drizzle";
import { type DatabaseProvider } from "./types";

export type ProviderType = "drizzle" | "convex" | "mongodb";

export function createDatabaseProvider(type: ProviderType): DatabaseProvider {
  switch (type) {
    case "drizzle":
      return new DrizzleProvider();
    default:
      throw new Error(`Unsupported database provider: ${type}`);
  }
}

export * from "./types";
