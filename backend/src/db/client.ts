/**
 * Database connection singleton for Travelog MVP1.
 *
 * Uses `pg` pool + Drizzle ORM with PostgreSQL/PostGIS.
 * Connection string comes from `DATABASE_URL` environment variable.
 */

import { loadRootEnv } from "../config/dotenv.js";

loadRootEnv();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const poolMax = Number(process.env.DATABASE_POOL_MAX) || 10;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
});

export const db = drizzle(pool, {
  logger: process.env.NODE_ENV === "development",
});

/**
 * Gracefully close the pool on process exit. pool.end() is awaited so the
 * exit does not truncate in-flight queries (e.g. a scan's final update).
 * Idempotent: a repeated signal must not call end() twice (pg-pool rejects).
 */
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await pool.end();
  } catch {
    // Pool already closed by a previous signal — nothing left to do.
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
