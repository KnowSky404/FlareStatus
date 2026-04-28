import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/env";
import * as statusEngineModule from "../lib/status-engine";
import worker from "../worker";

const OVERRIDE_SQL = `INSERT INTO overrides (id, target_type, target_id, override_status, message, starts_at, ends_at, created_by, created_at)
       SELECT ?, ?, id, ?, ?, ?, ?, 'operator', ?
       FROM components
       WHERE slug = ?`;
const ANNOUNCEMENT_SQL = `INSERT INTO announcements (id, title, body, status_level, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;
const LIST_SERVICES_SQL = "SELECT * FROM services ORDER BY sort_order";
const LIST_COMPONENTS_SQL = "SELECT * FROM components ORDER BY sort_order";
const INSERT_SERVICE_SQL = `INSERT INTO services (id, slug, name, description, sort_order, enabled, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const UPDATE_SERVICE_SQL = `UPDATE services
       SET slug = COALESCE(?, slug),
           name = COALESCE(?, name),
           description = COALESCE(?, description),
           sort_order = COALESCE(?, sort_order),
           enabled = COALESCE(?, enabled),
           updated_at = ?
       WHERE slug = ?`;

vi.mock("../lib/status-engine", () => ({
  recomputePublicStatus: vi.fn(),
}));

const recomputePublicStatus = vi.mocked(statusEngineModule.recomputePublicStatus);

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

beforeEach(() => {
  recomputePublicStatus.mockResolvedValue({
    generatedAt: "2026-04-27T00:00:00.000Z",
    summary: { status: "operational" },
    announcements: [],
    services: [],
  });
});

describe("admin override route", () => {
  it("returns the editable service catalog with nested components", async () => {
    const env = createEnv({
      prepare: (sql: string) => {
        if (sql === LIST_SERVICES_SQL) {
          return {
            all: async () => ({
              results: [
                {
                  id: "svc_1",
                  slug: "sub2api",
                  name: "Sub2API",
                  description: "Primary API",
                  sort_order: 0,
                  enabled: 1,
                  status: "operational",
                  updated_at: "2026-04-27T00:00:00.000Z",
                },
              ],
            }),
          } as D1PreparedStatement;
        }

        expect(sql).toBe(LIST_COMPONENTS_SQL);

        return {
          all: async () => ({
            results: [
              {
                id: "cmp_1",
                service_id: "svc_1",
                slug: "sub2api-public-api",
                name: "Public API",
                description: "Customer traffic",
                probe_type: "http",
                is_critical: 1,
                sort_order: 0,
                enabled: 1,
                observed_status: "operational",
                display_status: "operational",
                updated_at: "2026-04-27T00:00:00.000Z",
              },
            ],
          }),
        } as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog", {
        headers: { authorization: "Bearer test-admin-token" },
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          description: "Primary API",
          sortOrder: 0,
          enabled: true,
          status: "operational",
          components: [
            {
              id: "cmp_1",
              serviceId: "svc_1",
              slug: "sub2api-public-api",
              name: "Public API",
              description: "Customer traffic",
              probeType: "http",
              isCritical: true,
              sortOrder: 0,
              enabled: true,
              observedStatus: "operational",
              displayStatus: "operational",
            },
          ],
        },
      ],
    });
  });

  it("rejects unauthorized catalog requests", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog"),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
  });

  it("returns 400 for invalid service create payloads", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "",
          name: 42,
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 400 when service create slug is not route-addressable", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "bad/slug",
          name: "Sub2API Core",
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("creates a service and recomputes the public snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("service-123");

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(INSERT_SERVICE_SQL);

        return {
          bind: (...params: unknown[]) => {
            expect(params).toEqual([
              "service-123",
              "sub2api-core",
              "Sub2API Core",
              "Primary API",
              2,
              0,
              "degraded",
              "2026-04-27T10:00:00.000Z",
            ]);

            return {
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        } as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "sub2api-core",
          name: "Sub2API Core",
          description: "Primary API",
          sortOrder: 2,
          enabled: false,
          status: "degraded",
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      env.DB,
      env.STATUS_SNAPSHOTS,
      "2026-04-27T10:00:00.000Z",
    );
  });

  it("returns 409 when service create hits a duplicate slug conflict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("service-123");

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(INSERT_SERVICE_SQL);

        return {
          bind: () => ({
            run: async () => {
              throw new Error("D1_ERROR: UNIQUE constraint failed: services.slug");
            },
          }),
        } as unknown as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "sub2api-core",
          name: "Sub2API Core",
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("service slug already exists");
    expect(recomputePublicStatus).not.toHaveBeenCalled();
  });

  it("updates a service name and enabled flag", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T11:00:00.000Z"));

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(UPDATE_SERVICE_SQL);

        return {
          bind: (...params: unknown[]) => {
            expect(params).toEqual([
              "sub2api-core",
              "Sub2API Core",
              "Renamed primary API",
              3,
              0,
              "2026-04-27T11:00:00.000Z",
              "sub2api",
            ]);

            return {
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        } as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/sub2api", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "sub2api-core",
          name: "Sub2API Core",
          description: "Renamed primary API",
          sortOrder: 3,
          enabled: false,
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: true });
  });

  it("returns 400 for invalid service update payloads", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/sub2api", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: "no",
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 400 when service update slug is not route-addressable", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/sub2api", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "bad/slug",
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 409 when service update hits a duplicate slug conflict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T11:00:00.000Z"));

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(UPDATE_SERVICE_SQL);

        return {
          bind: () => ({
            run: async () => {
              throw new Error("D1_ERROR: UNIQUE constraint failed: services.slug");
            },
          }),
        } as unknown as D1PreparedStatement;
      },
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/sub2api", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "sub2api-core",
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("service slug already exists");
    expect(recomputePublicStatus).not.toHaveBeenCalled();
  });

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

  it("returns 400 for invalid override timestamps", async () => {
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
        startsAt: "2026-04-27T08:00:00Z",
      }),
    });

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 400 when an override window is reversed or zero-length", async () => {
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
        startsAt: "2026-04-27T08:00:00.000Z",
        endsAt: "2026-04-27T08:00:00.000Z",
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
              expect(params[4]).toBeNull();
              expect(params[5]).toBeNull();
              expect(params[7]).toBe("missing-component");

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
        startsAt: "2026-04-27T08:00:00.000Z",
        endsAt: "2026-04-27T10:00:00.000Z",
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
              "2026-04-27T10:00:00.000Z",
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
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      env.DB,
      env.STATUS_SNAPSHOTS,
      "2026-04-27T08:00:00.000Z",
    );
  });

  it("returns 201 after an override insert even if recompute fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("override-123");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const waitUntil = vi.fn(async (promise: Promise<unknown>) => {
      await promise;
    });
    recomputePublicStatus.mockRejectedValueOnce(new Error("kv unavailable"));

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

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(OVERRIDE_SQL);

        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 1 } }),
          }),
        } as D1PreparedStatement;
      },
    });
    const ctx = {
      waitUntil,
      passThroughOnException() {},
      props: {},
    } satisfies ExecutionContext;

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "failed to recompute public status after admin override insert",
      expect.any(Error),
    );
  });

  it("stores an announcement and recomputes the public snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:30:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("announcement-123");

    const request = new Request(
      "https://flarestatus.test/api/admin/announcements",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-admin-token",
        },
        body: JSON.stringify({
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
          statusLevel: "partial_outage",
          startsAt: "2026-04-27T08:30:00.000Z",
          endsAt: "2026-04-27T09:30:00.000Z",
        }),
      },
    );

    let runCalled = false;

    const env = createEnv({
      prepare: (sql: string) => {
        expect(sql).toBe(ANNOUNCEMENT_SQL);

        return {
          bind: (...params: unknown[]) => {
            expect(params).toEqual([
              "announcement-123",
              "Scheduled maintenance",
              "API traffic may be intermittently unavailable.",
              "partial_outage",
              "2026-04-27T08:30:00.000Z",
              "2026-04-27T09:30:00.000Z",
              "2026-04-27T08:30:00.000Z",
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
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      env.DB,
      env.STATUS_SNAPSHOTS,
      "2026-04-27T08:30:00.000Z",
    );
  });

  it("returns 400 for invalid announcement timestamps", async () => {
    const request = new Request(
      "https://flarestatus.test/api/admin/announcements",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-admin-token",
        },
        body: JSON.stringify({
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
          statusLevel: "partial_outage",
          startsAt: "2026-04-27T08:30:00.000+00:00",
        }),
      },
    );

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 400 when an announcement window is reversed", async () => {
    const request = new Request(
      "https://flarestatus.test/api/admin/announcements",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-admin-token",
        },
        body: JSON.stringify({
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
          statusLevel: "partial_outage",
          startsAt: "2026-04-27T09:30:00.000Z",
          endsAt: "2026-04-27T09:00:00.000Z",
        }),
      },
    );

    const response = await worker.fetch(request, createEnv(), createCtx());

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });
});
