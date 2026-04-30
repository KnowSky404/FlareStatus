import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, RuntimeContext } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";
import worker from "../worker";
import { RecordingSqlConnection, normalizeSql } from "./helpers/postgres";

vi.mock("../lib/status-engine", () => ({
  recomputePublicStatus: vi.fn(),
}));

const validPayload = {
  componentSlug: "sub2api-health",
  status: "operational",
  latencyMs: 120,
  summary: "HTTP 200 in 120ms",
  checkedAt: "2026-04-27T10:00:00.000Z",
};

interface DbCallState {
  queryCount: number;
}

const recomputePublicStatusMock = vi.mocked(recomputePublicStatus);
const INSERT_PROBE_RESULT_SQL = `INSERT INTO probe_results (id, component_id, probe_source, status, latency_ms, summary, checked_at)
     SELECT $1, id, $2, $3, $4, $5, $6 FROM components WHERE slug = $7
     RETURNING id`;

function createCtx() {
  const waitUntilPromises: Promise<unknown>[] = [];
  const defer = vi.fn((promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  });
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  });

  return {
    ctx: {
      defer,
      waitUntil,
      passThroughOnException() {},
      props: {},
    } as RuntimeContext & { defer: typeof defer },
    defer,
    waitUntil,
    waitUntilPromises,
  };
}

function createEnv(options?: {
  expectedParams?: unknown[];
  rows?: Array<{ id: string }>;
  db?: unknown;
}): { env: Env; dbCalls: DbCallState } {
  const expectedParams = options?.expectedParams;
  const rows = options?.rows ?? [{ id: "probe-1" }];
  const db =
    options?.db ??
    new RecordingSqlConnection().when(INSERT_PROBE_RESULT_SQL, (params) => {
      expect(params).toHaveLength(7);
      expect(typeof params?.[0]).toBe("string");

      if (expectedParams) {
        expect(params?.slice(1)).toEqual(expectedParams);
      }

      return rows;
    });

  const env = {
    ASSETS: {
      fetch: async () => new Response("asset shell"),
    },
    db,
    probeApiToken: "test-probe-token",
    adminApiToken: "admin-token",
  } as unknown as Env;

  return {
    env,
    dbCalls: {
      queryCount:
        db instanceof RecordingSqlConnection ? db.log.length : 0,
    },
  };
}

function createRequest(
  body: BodyInit,
  token = "test-probe-token",
  scheme = "Bearer",
) {
  return new Request("https://flarestatus.test/api/probe/report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `${scheme} ${token}`,
    },
    body,
  });
}

describe("probe ingest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    recomputePublicStatusMock.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a signed report payload, stores its summary, and rebuilds public status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:05:00.000Z"));

    const { env } = createEnv({
      expectedParams: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });
    const db = (env as Env & { db: RecordingSqlConnection }).db;
    const { ctx, defer, waitUntil } = createCtx();

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      ctx,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(db.log.map((entry) => normalizeSql(entry.query))).toEqual([
      normalizeSql(INSERT_PROBE_RESULT_SQL),
    ]);
    expect(recomputePublicStatusMock).toHaveBeenCalledWith(
      db,
      "2026-04-27T10:05:00.000Z",
    );
    expect(defer).toHaveBeenCalledTimes(1);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("accepts a signed report payload with lowercase bearer auth", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:05:00.000Z"));

    const { env } = createEnv({
      expectedParams: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });
    const { ctx } = createCtx();

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload), "test-probe-token", "bearer"),
      env,
      ctx,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(recomputePublicStatusMock).toHaveBeenCalledWith(
      (env as Env & { db: RecordingSqlConnection }).db,
      "2026-04-27T10:05:00.000Z",
    );
  });

  it("accepts a report when summary is omitted and stores an empty summary value", async () => {
    const { env } = createEnv({
      expectedParams: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        "",
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });
    const { ctx } = createCtx();

    const { summary: _summary, ...payloadWithoutSummary } = validPayload;
    const response = await worker.fetch(
      createRequest(JSON.stringify(payloadWithoutSummary)),
      env,
      ctx,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });

  it("returns 202 after a successful insert even when recompute fails", async () => {
    const { env } = createEnv({
      expectedParams: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });
    const error = new Error("kv write failed");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recomputePublicStatusMock.mockRejectedValue(error);
    const { ctx, waitUntilPromises } = createCtx();

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      ctx,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    await Promise.all(waitUntilPromises);
    expect(recomputePublicStatusMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "probe ingest recompute failed",
      error,
    );
  });

  it("returns 202 without waiting for recompute to finish", async () => {
    const { env } = createEnv({
      expectedParams: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });
    const { ctx, waitUntilPromises } = createCtx();
    recomputePublicStatusMock.mockReturnValue(new Promise(() => {}) as never);

    const result = await Promise.race([
      worker.fetch(createRequest(JSON.stringify(validPayload)), env, ctx),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 25)),
    ]);

    expect(result).not.toBe("timeout");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(202);
    expect(waitUntilPromises).toHaveLength(1);
  });

  it("returns 503 when the app env does not expose a postgres sql connection", async () => {
    const { env } = createEnv({
      db: {
        prepare() {
          throw new Error("legacy prepare should not be used");
        },
      },
    });

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("probe ingest unavailable");
    expect(recomputePublicStatusMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized request without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload), "wrong-token"),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
  });

  it("rejects an invalid payload without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, latencyMs: "120" })),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("rejects an unknown status string without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, status: "down" })),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("rejects a negative latency without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, latencyMs: -1 })),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("rejects an invalid checkedAt value without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, checkedAt: "not-a-date" })),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("rejects an impossible calendar timestamp without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(
        JSON.stringify({
          ...validPayload,
          checkedAt: "2026-02-31T00:00:00.000Z",
        }),
      ),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("rejects a checkedAt value that is too far in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:00:00.000Z"));

    const { env } = createEnv();

    const response = await worker.fetch(
      createRequest(
        JSON.stringify({
          ...validPayload,
          checkedAt: "2026-04-27T10:10:01.000Z",
        }),
      ),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(recomputePublicStatusMock).not.toHaveBeenCalled();
  });

  it("rejects malformed json without touching the db", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(createRequest("{"), env, createCtx().ctx);

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 404 when the component slug is unknown", async () => {
    const { env } = createEnv({ rows: [] });
    const db = (env as Env & { db: RecordingSqlConnection }).db;

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      createCtx().ctx,
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("component not found");
    expect(db.log.map((entry) => normalizeSql(entry.query))).toEqual([
      normalizeSql(INSERT_PROBE_RESULT_SQL),
    ]);
    expect(recomputePublicStatusMock).not.toHaveBeenCalled();
  });
});
