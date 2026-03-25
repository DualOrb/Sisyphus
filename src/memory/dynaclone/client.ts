import * as mysql from "mysql2/promise";
import type { Pool, PoolOptions, RowDataPacket } from "mysql2/promise";
import { createChildLogger, fetchDynaCloneCredentials } from "../../lib/index.js";

const log = createChildLogger("dynaclone");

/**
 * Connection configuration passed directly (non-secret-manager path).
 */
export interface DynaCloneConnectionConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
}

/**
 * A function that resolves DynaClone credentials from an external source
 * (e.g. AWS Secrets Manager).
 */
export type SecretsLookupFn = () => Promise<DynaCloneConnectionConfig>;

/**
 * Read-only MySQL client for the DynaClone replica of DynamoDB.
 *
 * DynaClone mirrors DynamoDB tables into MySQL for queries that DynamoDB
 * handles poorly: time-range joins, aggregations, multi-condition filters.
 *
 * **IMPORTANT:** DynaClone is READ-ONLY. All writes go through DynamoDB.
 */
export class DynaCloneClient {
  private pool: Pool | null = null;
  private readonly configOrLookup: DynaCloneConnectionConfig | SecretsLookupFn;

  constructor(configOrLookup: DynaCloneConnectionConfig | SecretsLookupFn) {
    this.configOrLookup = configOrLookup;
  }

  /**
   * Lazily initialise the connection pool. If a secrets lookup function was
   * provided, it is called once on first use and the resolved config is
   * cached for the lifetime of the pool.
   */
  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;

    let config: DynaCloneConnectionConfig;

    if (typeof this.configOrLookup === "function") {
      log.info("Resolving DynaClone credentials from secrets provider");
      config = await this.configOrLookup();
    } else {
      config = this.configOrLookup;
    }

    const poolOpts: PoolOptions = {
      host: config.host,
      user: config.user,
      password: config.password,
      database: config.database,
      port: config.port ?? 3306,
      waitForConnections: true,
      connectionLimit: 5, // light read-only usage
      queueLimit: 0,
      connectTimeout: 10_000,
      // Ensure all fields come back as strings (DynaClone quirk: everything
      // is a string anyway) so callers use the typed parse helpers.
      typeCast: true,
    };

    this.pool = mysql.createPool(poolOpts);

    // Verify connectivity on first connection
    try {
      const conn = await this.pool.getConnection();
      log.info(
        { host: config.host, database: config.database },
        "DynaClone connection pool created",
      );
      conn.release();
    } catch (err) {
      log.error({ err }, "DynaClone initial connection failed");
      throw err;
    }

    return this.pool;
  }

  /**
   * Execute a read-only SQL query against DynaClone.
   *
   * @param sql - Parameterised SQL string (use `?` placeholders)
   * @param params - Bind parameters
   * @returns Typed row array
   */
  async query<T extends RowDataPacket = RowDataPacket>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const pool = await this.getPool();

    try {
      const [rows] = await pool.query<T[]>(sql, params);
      return rows;
    } catch (err) {
      log.error({ err, sql, params }, "DynaClone query failed");
      throw err;
    }
  }

  /**
   * Drain and close all connections in the pool.
   */
  async close(): Promise<void> {
    if (this.pool) {
      log.info("Closing DynaClone connection pool");
      await this.pool.end();
      this.pool = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory: create a DynaCloneClient backed by AWS Secrets Manager
// ---------------------------------------------------------------------------

/**
 * Create a {@link DynaCloneClient} whose credentials are lazily fetched from
 * AWS Secrets Manager.
 *
 * The client uses a {@link SecretsLookupFn} so the actual network call is
 * deferred until the first query, and the secret is cached in-process for
 * 5 minutes (handled by `fetchDynaCloneCredentials`).
 *
 * @param secretId - Secret name or ARN (e.g. `vendorportal/credentials`)
 * @param region   - AWS region (defaults to `us-east-1`)
 */
export function createDynaCloneFromSecrets(
  secretId: string,
  region = "us-east-1",
): DynaCloneClient {
  const lookup: SecretsLookupFn = async () => {
    log.info({ secretId, region }, "Fetching DynaClone credentials from Secrets Manager");
    const creds = await fetchDynaCloneCredentials(secretId, region);
    return {
      host: creds.host,
      user: creds.user,
      password: creds.password,
      database: creds.database,
    };
  };

  return new DynaCloneClient(lookup);
}
