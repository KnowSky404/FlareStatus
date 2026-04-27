import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/env";
import worker from "../worker";

const OVERRIDE_SQL = `INSERT INTO overrides (id, target_type, target_id, override_status, message, created_by, created_at)
       SELECT ?, ?, id, ?, ?, 'operator', ?
       FROM components
       WHERE slug = ?`;

function createCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  };
}

function createEnv({
  prepare,
}: {
  prepare?: D1Database["prepare"];
} = {}): Env {
  const assets = {
    fetch: async () => new Response("asset fallback"),
  } as unknown as Fetcher;

  const statusSnapshots = {
    get: async () => null,
  } as unknown as KVNamespace;

  return {
    ADMIN_API_TOKEN: "test-admin-token",
    PROBE_API_TOKEN: "probe-token",
    ASSETS: assets,
    STATUS_SNAPSHOTS: statusSnapshots,
    DB: {
      prepare:
        prepare ??
        (() => {
          throw new Error("DB.prepare should not be called");
        }),
    } as D1Database,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("admin override route", () => {
  it("rejects unauthorized requests", async () => {
    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        targetType: "component",
        targetSlug: "sub2api-public-api",
        overrideStatus: "degraded",
        message: "Increased latency under investigation",
      }),
    });

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
  });

  it("returns 400 for malformed JSON", async () => {
    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: "{",
    });

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 400 for invalid payload fields", async () => {
    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({
        targetType: "component",
        targetSlug: 42,
        overrideStatus: "broken",
        message: null,
      }),
    });

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 404 when the target slug does not match a row", async () => {
    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({
        targetType: "component",
        targetSlug: "missing-component",
        overrideStatus: "degraded",
        message: "Increased latency under investigation",
      }),
    });

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(OVERRIDE_SQL);

        return {
          bind: (...params: unknown[]) => ({
            run: async () => {
              expect(params[1]).toBe("component");
              expect(params[2]).toBe("degraded");
              expect(params[3]).toBe("Increased latency under investigation");
              expect(params[5]).toBe("missing-component");

              return { meta: { changes: 0 } };
            },
          }),
        } as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(request, env, createCtx());

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("target not found");
  });

  it("stores an operator-issued component override", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("override-123");

    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({
        targetType: "component",
        targetSlug: "sub2api-public-api",
        overrideStatus: "degraded",
        message: "Increased latency under investigation",
      }),
    });

    let runCalled = false;

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(OVERRIDE_SQL);

        return {
          bind: (...params: unknown[]) => {
            expect(params).toEqual([
              "override-123",
              "component",
              "degraded",
              "Increased latency under investigation",
              "2026-04-27T08:00:00.000Z",
              "sub2api-public-api",
            ]);

            return {
              run: async () => {
                runCalled = true;
                return { meta: { changes: 1 } };
              },
            };
          },
        } as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(request, env, createCtx());

    expect(runCalled).toBe(true);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
  });
});
