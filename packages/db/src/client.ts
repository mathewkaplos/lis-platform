import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export interface CreateDbOptions {
  // Forwarded to pg.Pool's own `max` option (default 10). Exposed
  // deliberately — TASK-030/ADR-0010's pooling-leak test needs to force a
  // small pool (e.g. 1) to prove SET LOCAL-based tenant binding survives
  // physical-connection reuse across different tenants' requests, which a
  // default-sized pool wouldn't reliably exercise in a short test run.
  max?: number;
}

export function createDb(
  connectionString = process.env.DATABASE_URL,
  options?: CreateDbOptions,
) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString, max: options?.max });
  return drizzle(pool, { schema });
}

export * as schema from "./schema";
