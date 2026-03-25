import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("aws-secrets");

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (matches VendorPortal pattern)

interface CacheEntry {
  value: Record<string, string>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Visible-for-testing helper: flush the in-memory secrets cache.
 */
export function clearSecretsCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Generic secret fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch a JSON-encoded secret from AWS Secrets Manager.
 *
 * Results are cached in-process for {@link CACHE_TTL} ms so repeated calls
 * within the same warm process do not hit the network.
 *
 * @param secretId - The secret name or ARN (e.g. `vendorportal/credentials`)
 * @param region   - AWS region (defaults to `us-east-1`)
 * @returns The parsed key/value pairs from the secret's JSON string.
 */
export async function fetchSecret(
  secretId: string,
  region = "us-east-1",
): Promise<Record<string, string>> {
  const cacheKey = `${region}::${secretId}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    log.debug({ secretId }, "Returning cached secret");
    return cached.value;
  }

  const client = new SecretsManagerClient({ region });

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );

    if (!response.SecretString) {
      throw new Error(
        `Secret "${secretId}" exists but has no SecretString (binary secrets are not supported)`,
      );
    }

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(response.SecretString) as Record<string, string>;
    } catch {
      throw new Error(
        `Secret "${secretId}" contains invalid JSON: unable to parse SecretString`,
      );
    }

    cache.set(cacheKey, { value: parsed, expiresAt: now + CACHE_TTL });
    log.info({ secretId }, "Fetched and cached secret from Secrets Manager");

    return parsed;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    log.error({ secretId, err: message }, "Failed to retrieve secret");
    throw new Error(
      `Unable to retrieve secret "${secretId}": ${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// DynaClone-specific credentials
// ---------------------------------------------------------------------------

/**
 * Shape of the credential fields Sisyphus needs to connect to DynaClone.
 *
 * The secret stored in AWS Secrets Manager (e.g. `vendorportal/credentials`)
 * uses the keys `db_host`, `db_user`, `db_password`, `db_name`.  This type
 * normalises them into the names the DynaCloneClient expects.
 */
export interface DynaCloneCredentials {
  host: string;
  user: string;
  password: string;
  database: string;
  /** Explicit DynaClone DB name override (optional). */
  dynaclone_db_name?: string;
  /** Supervisor-specific DB name override (optional). */
  supervisor_db_name?: string;
}

/**
 * Fetch DynaClone MySQL credentials from AWS Secrets Manager.
 *
 * Maps the raw secret keys (`db_host`, `db_user`, `db_password`, `db_name`)
 * to the {@link DynaCloneCredentials} shape expected by the MySQL client.
 *
 * @param secretId - Secret name or ARN (e.g. `vendorportal/credentials`)
 * @param region   - AWS region (defaults to `us-east-1`)
 */
export async function fetchDynaCloneCredentials(
  secretId: string,
  region = "us-east-1",
): Promise<DynaCloneCredentials> {
  const secret = await fetchSecret(secretId, region);

  const host = secret.db_host;
  const user = secret.db_user;
  const password = secret.db_password;
  const database = secret.dynaclone_db_name ?? secret.db_name;

  if (!host || !user || !password || !database) {
    const missing = [
      !host && "db_host",
      !user && "db_user",
      !password && "db_password",
      !database && "db_name / dynaclone_db_name",
    ].filter(Boolean);

    throw new Error(
      `Secret "${secretId}" is missing required DynaClone fields: ${missing.join(", ")}`,
    );
  }

  return {
    host,
    user,
    password,
    database,
    ...(secret.dynaclone_db_name
      ? { dynaclone_db_name: secret.dynaclone_db_name }
      : {}),
    ...(secret.supervisor_db_name
      ? { supervisor_db_name: secret.supervisor_db_name }
      : {}),
  };
}
