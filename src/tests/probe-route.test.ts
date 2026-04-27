import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";
import worker from "../worker";

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
  prepareCalled: boolean;
  bindCalled: boolean;
  runCalled: boolean;
}

type D1RunResult = Awaited<ReturnType<D1PreparedStatement["run"]>>;
const recomputePublicStatusMock = vi.mocked(recomputePublicStatus);

function createEnv(options?: {
  expectedBindings?: unknown[];
  changes?: number;
}): { env: Env; dbCalls: DbCallState } {
  const expectedBindings = options?.expectedBindings;
  const changes = options?.changes ?? 1;
  const dbCalls: DbCallState = {
    prepareCalled: false,
    bindCalled: false,
    runCalled: false,
  };

  const assetsFetch: Fetcher["fetch"] = async (_request) =>
    new Response("asset shell");
  const assetsConnect: Fetcher["connect"] = () => {
    throw new Error("connect not implemented in test");
  };

  const run = async (): Promise<D1RunResult> => {
    dbCalls.runCalled = true;

    return {
      success: true,
      meta: {
        changes,
        last_row_id: 0,
        changed_db: changes > 0,
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: changes,
        served_by: "test",
      },
      results: [],
    };
  };

  const bind = (...bindings: unknown[]) => {
    dbCalls.bindCalled = true;

    expect(bindings).toHaveLength(7);
    expect(typeof bindings[0]).toBe("string");

    if (expectedBindings) {
      expect(bindings.slice(1)).toEqual(expectedBindings);
    }

    return { run } as Pick<D1PreparedStatement, "run">;
  };

  const prepare = (sql: string) => {
    dbCalls.prepareCalled = true;

    expect(sql).toBe(
      `INSERT INTO probe_results (id, component_id, probe_source, status, latency_ms, summary, checked_at)
     SELECT ?, id, ?, ?, ?, ?, ? FROM components WHERE slug = ?`,
    );

    return { bind } as Pick<D1PreparedStatement, "bind">;
  };

  const env: Env = {
    ASSETS: { fetch: assetsFetch, connect: assetsConnect },
    DB: { prepare } as D1Database,
    STATUS_SNAPSHOTS: {} as KVNamespace,
    PROBE_API_TOKEN: "test-probe-token",
    ADMIN_API_TOKEN: "admin-token",
  };

  return { env, dbCalls };
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

    const { env, dbCalls } = createEnv({
      expectedBindings: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(dbCalls).toEqual({
      prepareCalled: true,
      bindCalled: true,
      runCalled: true,
    });
    expect(recomputePublicStatusMock).toHaveBeenCalledWith(
      env.DB,
      env.STATUS_SNAPSHOTS,
      "2026-04-27T10:05:00.000Z",
    );
  });

  it("accepts a signed report payload with lowercase bearer auth", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:05:00.000Z"));

    const { env, dbCalls } = createEnv({
      expectedBindings: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        validPayload.summary,
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload), "test-probe-token", "bearer"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(dbCalls).toEqual({
      prepareCalled: true,
      bindCalled: true,
      runCalled: true,
    });
    expect(recomputePublicStatusMock).toHaveBeenCalledWith(
      env.DB,
      env.STATUS_SNAPSHOTS,
      "2026-04-27T10:05:00.000Z",
    );
  });

  it("accepts a report when summary is omitted and stores an empty summary value", async () => {
    const { env, dbCalls } = createEnv({
      expectedBindings: [
        "docker-probe",
        validPayload.status,
        validPayload.latencyMs,
        "",
        validPayload.checkedAt,
        validPayload.componentSlug,
      ],
    });

    const { summary: _summary, ...payloadWithoutSummary } = validPayload;
    const response = await worker.fetch(
      createRequest(JSON.stringify(payloadWithoutSummary)),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(dbCalls).toEqual({
      prepareCalled: true,
      bindCalled: true,
      runCalled: true,
    });
  });

  it("returns 202 after a successful insert even when recompute fails", async () => {
    const { env, dbCalls } = createEnv({
      expectedBindings: [
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

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(dbCalls).toEqual({
      prepareCalled: true,
      bindCalled: true,
      runCalled: true,
    });
    expect(recomputePublicStatusMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "probe ingest recompute failed",
      error,
    );
  });

  it("rejects an unauthorized request without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload), "wrong-token"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects an invalid payload without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, latencyMs: "120" })),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects an unknown status string without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, status: "down" })),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects a negative latency without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, latencyMs: -1 })),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects an invalid checkedAt value without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(JSON.stringify({ ...validPayload, checkedAt: "not-a-date" })),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects an impossible calendar timestamp without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(
        JSON.stringify({
          ...validPayload,
          checkedAt: "2026-02-31T00:00:00.000Z",
        }),
      ),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("rejects a checkedAt value that is too far in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:00:00.000Z"));

    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(
      createRequest(
        JSON.stringify({
          ...validPayload,
          checkedAt: "2026-04-27T10:10:01.000Z",
        }),
      ),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
    expect(recomputePublicStatusMock).not.toHaveBeenCalled();
  });

  it("rejects malformed json without touching the db", async () => {
    const { env, dbCalls } = createEnv();

    const response = await worker.fetch(createRequest("{"), env, {} as ExecutionContext);

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
    expect(dbCalls).toEqual({
      prepareCalled: false,
      bindCalled: false,
      runCalled: false,
    });
  });

  it("returns 404 when the component slug is unknown", async () => {
    const { env, dbCalls } = createEnv({ changes: 0 });

    const response = await worker.fetch(
      createRequest(JSON.stringify(validPayload)),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("component not found");
    expect(dbCalls).toEqual({
      prepareCalled: true,
      bindCalled: true,
      runCalled: true,
    });
    expect(recomputePublicStatusMock).not.toHaveBeenCalled();
  });
});
