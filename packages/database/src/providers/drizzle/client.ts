import { serverEnv } from "@repo/config/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index";

const { Pool } = pg;

/**
 * Singleton pattern for database connection pool to prevent exhaustion
 * during hot-reload in development and serverless environments.
 */
interface GlobalWithDb {
  __db_pool?: pg.Pool;
}

const globalWithDb = globalThis as unknown as GlobalWithDb;

export const pool =
  globalWithDb.__db_pool ??
  new Pool({
    connectionString: serverEnv.DATABASE_URL,
  });

if (serverEnv.NODE_ENV !== "production") {
  globalWithDb.__db_pool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
