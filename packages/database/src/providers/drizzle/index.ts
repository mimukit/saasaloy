import { type DatabaseProvider } from "../types";
import { type Database, db, pool } from "./client";

export class DrizzleProvider implements DatabaseProvider<Database> {
  readonly name = "drizzle";
  private connected = false;

  get client(): Database {
    return db;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // Drizzle doesn't have an explicit connect,
      // but we can test the pool connection
      await pool.query("SELECT 1");
      this.connected = true;
    } catch (error) {
      console.error("Failed to connect to PostgreSQL:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    await pool.end();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
