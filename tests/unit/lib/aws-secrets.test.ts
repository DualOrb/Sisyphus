import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSecret,
  fetchDynaCloneCredentials,
  clearSecretsCache,
} from "@lib/aws-secrets.js";

// ---------------------------------------------------------------------------
// Mock the AWS SDK
// ---------------------------------------------------------------------------

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: vi.fn().mockImplementation(() => ({
      send: sendMock,
    })),
    GetSecretValueCommand: vi.fn().mockImplementation((input: unknown) => input),
  };
});

// Suppress pino log output during tests
vi.mock("@lib/logger.js", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSecretResponse(obj: Record<string, string>) {
  return { SecretString: JSON.stringify(obj) };
}

const VALID_SECRET = {
  db_host: "iris.valleyeats.ca",
  db_user: "dispatch_ro",
  db_password: "s3cret!",
  db_name: "admin_dynaclone",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchSecret", () => {
  beforeEach(() => {
    clearSecretsCache();
    sendMock.mockReset();
  });

  afterEach(() => {
    clearSecretsCache();
  });

  it("parses a JSON SecretString into a Record", async () => {
    sendMock.mockResolvedValueOnce(makeSecretResponse(VALID_SECRET));

    const result = await fetchSecret("vendorportal/credentials");

    expect(result).toEqual(VALID_SECRET);
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("passes the correct SecretId to the command", async () => {
    sendMock.mockResolvedValueOnce(makeSecretResponse(VALID_SECRET));

    await fetchSecret("my-custom/secret");

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ SecretId: "my-custom/secret" }),
    );
  });

  it("throws when SecretString is missing (binary secret)", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: undefined });

    await expect(fetchSecret("vendorportal/credentials")).rejects.toThrow(
      /no SecretString/,
    );
  });

  it("throws when SecretString is not valid JSON", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: "not-json{{{" });

    await expect(fetchSecret("vendorportal/credentials")).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it("wraps SDK errors with a descriptive message", async () => {
    sendMock.mockRejectedValueOnce(new Error("AccessDeniedException"));

    await expect(fetchSecret("vendorportal/credentials")).rejects.toThrow(
      /Unable to retrieve secret "vendorportal\/credentials": AccessDeniedException/,
    );
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  it("returns cached result on second call within TTL", async () => {
    sendMock.mockResolvedValueOnce(makeSecretResponse(VALID_SECRET));

    const first = await fetchSecret("vendorportal/credentials");
    const second = await fetchSecret("vendorportal/credentials");

    expect(first).toBe(second); // same reference
    expect(sendMock).toHaveBeenCalledOnce(); // only one network call
  });

  it("re-fetches after the cache expires", async () => {
    // First call — succeeds and populates cache
    sendMock.mockResolvedValueOnce(makeSecretResponse(VALID_SECRET));
    await fetchSecret("vendorportal/credentials");

    // Advance time past TTL (5 minutes + 1 ms)
    const realDateNow = Date.now;
    const baseTime = Date.now();
    Date.now = () => baseTime + 5 * 60 * 1000 + 1;

    const updatedSecret = { ...VALID_SECRET, db_host: "new-host.valleyeats.ca" };
    sendMock.mockResolvedValueOnce(makeSecretResponse(updatedSecret));

    const result = await fetchSecret("vendorportal/credentials");

    expect(result.db_host).toBe("new-host.valleyeats.ca");
    expect(sendMock).toHaveBeenCalledTimes(2);

    // Restore Date.now
    Date.now = realDateNow;
  });

  it("caches independently per secretId + region", async () => {
    sendMock
      .mockResolvedValueOnce(makeSecretResponse({ key: "a" }))
      .mockResolvedValueOnce(makeSecretResponse({ key: "b" }));

    const a = await fetchSecret("secret-a", "us-east-1");
    const b = await fetchSecret("secret-b", "us-east-1");

    expect(a).toEqual({ key: "a" });
    expect(b).toEqual({ key: "b" });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// DynaClone credential extraction
// ---------------------------------------------------------------------------

describe("fetchDynaCloneCredentials", () => {
  beforeEach(() => {
    clearSecretsCache();
    sendMock.mockReset();
  });

  afterEach(() => {
    clearSecretsCache();
  });

  it("maps db_host/db_user/db_password/db_name to DynaCloneCredentials", async () => {
    sendMock.mockResolvedValueOnce(makeSecretResponse(VALID_SECRET));

    const creds = await fetchDynaCloneCredentials("vendorportal/credentials");

    expect(creds).toEqual({
      host: "iris.valleyeats.ca",
      user: "dispatch_ro",
      password: "s3cret!",
      database: "admin_dynaclone",
    });
  });

  it("prefers dynaclone_db_name over db_name when present", async () => {
    sendMock.mockResolvedValueOnce(
      makeSecretResponse({
        ...VALID_SECRET,
        dynaclone_db_name: "custom_dynaclone",
      }),
    );

    const creds = await fetchDynaCloneCredentials("vendorportal/credentials");

    expect(creds.database).toBe("custom_dynaclone");
    expect(creds.dynaclone_db_name).toBe("custom_dynaclone");
  });

  it("includes supervisor_db_name when present in the secret", async () => {
    sendMock.mockResolvedValueOnce(
      makeSecretResponse({
        ...VALID_SECRET,
        supervisor_db_name: "admin_supervisor",
      }),
    );

    const creds = await fetchDynaCloneCredentials("vendorportal/credentials");

    expect(creds.supervisor_db_name).toBe("admin_supervisor");
  });

  it("throws when required fields are missing", async () => {
    sendMock.mockResolvedValueOnce(
      makeSecretResponse({ db_host: "host", db_user: "user" }),
    );

    await expect(
      fetchDynaCloneCredentials("vendorportal/credentials"),
    ).rejects.toThrow(/missing required DynaClone fields.*db_password.*db_name/);
  });

  it("throws when secret is completely empty", async () => {
    sendMock.mockResolvedValueOnce(makeSecretResponse({}));

    await expect(
      fetchDynaCloneCredentials("vendorportal/credentials"),
    ).rejects.toThrow(/missing required DynaClone fields/);
  });
});
