import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../../db/schema.js";
import { createChildLogger } from "../../lib/index.js";

const log = createChildLogger("postgres");

export type PostgresDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a Drizzle ORM instance backed by a pg Pool.
 *
 * @param url - PostgreSQL connection string
 * @returns Drizzle instance with full schema type inference
 */
export function createPostgresClient(url: string): PostgresDb {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (err) => {
    log.error({ err }, "PostgreSQL pool error");
  });

  pool.on("connect", () => {
    log.debug("PostgreSQL pool: new connection");
  });

  log.info("PostgreSQL pool created");

  return drizzle(pool, { schema });
}
