import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listActiveOverrides, listLatestProbeResults } from "../lib/db";
import type { Env, RuntimeContext } from "../lib/env";
import * as statusEngineModule from "../lib/status-engine";
import { RecordingSqlConnection, normalizeSql } from "./helpers/postgres";
import worker from "../worker";

const OVERRIDE_SQL = `INSERT INTO overrides (id, target_type, target_id, override_status, message, starts_at, ends_at, created_by, created_at)
       SELECT $1, $2, id, $3, $4, $5, $6, 'operator', $7
       FROM components
       WHERE slug = $8
       RETURNING id`;
const ANNOUNCEMENT_SQL = `INSERT INTO announcements (id, title, body, status_level, starts_at, ends_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`;
const LIST_SERVICES_SQL = `SELECT
       id,
       slug,
       name,
       description,
       sort_order,
       enabled,
       status,
       updated_at::text AS updated_at
     FROM services
     ORDER BY sort_order`;
const LIST_COMPONENTS_SQL = `SELECT
       id,
       service_id,
       slug,
       name,
       description,
       probe_type,
       is_critical,
       sort_order,
       enabled,
       observed_status,
       display_status,
       updated_at::text AS updated_at
     FROM components
     ORDER BY sort_order`;
const INSERT_SERVICE_SQL = `INSERT INTO services (id, slug, name, description, sort_order, enabled, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`;
const UPDATE_SERVICE_SQL = `UPDATE services
       SET slug = COALESCE($1, slug),
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           sort_order = COALESCE($4, sort_order),
           enabled = COALESCE($5, enabled),
           updated_at = $6
       WHERE slug = $7
       RETURNING id`;
const INSERT_COMPONENT_SQL = `INSERT INTO components (id, service_id, slug, name, description, probe_type, is_critical, sort_order, enabled, observed_status, display_status, updated_at)
       SELECT $1, id, $2, $3, $4, $5, $6, $7, $8, 'operational', 'operational', $9
       FROM services
       WHERE slug = $10
       RETURNING id`;
const UPDATE_COMPONENT_SQL = `UPDATE components
       SET slug = COALESCE($1, slug),
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           probe_type = COALESCE($4, probe_type),
           is_critical = COALESCE($5, is_critical),
           sort_order = COALESCE($6, sort_order),
           enabled = COALESCE($7, enabled),
           updated_at = $8
       WHERE slug = $9
       RETURNING id`;
const UPDATE_SERVICE_ORDER_SQL = `UPDATE services
       SET sort_order = $1, updated_at = $2
       WHERE slug = $3`;
const UPDATE_COMPONENT_ORDER_SQL = `UPDATE components
       SET sort_order = $1, updated_at = $2
       WHERE slug = $3`;
const LIST_LATEST_PROBE_RESULTS_SQL = `WITH ranked_probe_results AS (
       SELECT
         id,
         component_id,
         probe_source,
         status,
         latency_ms,
         http_code,
         summary,
         raw_payload::text AS raw_payload,
         checked_at::text AS checked_at,
         ROW_NUMBER() OVER (
           PARTITION BY component_id
           ORDER BY checked_at DESC, xmin::text::bigint DESC, ctid DESC
         ) AS probe_rank
       FROM probe_results
     )
     SELECT
       id,
       component_id,
       probe_source,
       status,
       latency_ms,
       http_code,
       summary,
       raw_payload,
       checked_at
     FROM ranked_probe_results
     WHERE probe_rank = 1
     ORDER BY component_id`;
const LIST_ACTIVE_OVERRIDES_SQL = `SELECT
       id,
       target_type,
       target_id,
       override_status,
       message,
       starts_at::text AS starts_at,
       ends_at::text AS ends_at,
       created_by,
       created_at::text AS created_at
     FROM overrides
     WHERE (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $2)
     ORDER BY created_at DESC, xmin::text::bigint DESC, ctid DESC`;

vi.mock("../lib/status-engine", () => ({
  recomputePublicStatus: vi.fn(),
}));

const recomputePublicStatus = vi.mocked(statusEngineModule.recomputePublicStatus);

function createCtx() {
  const deferred: Promise<unknown>[] = [];
  const defer = vi.fn((promise: Promise<unknown>) => {
    deferred.push(promise);
  });
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    deferred.push(promise);
  });
  const ctx = {
    defer,
    waitUntil,
    passThroughOnException() {},
    props: {},
  } as RuntimeContext & { defer: typeof defer };

  return {
    ...ctx,
    ctx,
    defer,
    waitUntil,
    deferred,
  };
}

function createDefaultDb() {
  return {
    unsafe: async () => {
      throw new Error("db.unsafe should not be called");
    },
    begin: async () => {
      throw new Error("db.begin should not be called");
    },
  };
}

function createEnv({
  db,
  adminApiToken,
  probeApiToken,
}: {
  db?: unknown;
  adminApiToken?: string;
  probeApiToken?: string;
} = {}): Env {
  return {
    ASSETS: {
      fetch: async () => new Response("asset fallback"),
    },
    db: db ?? createDefaultDb(),
    adminApiToken:
      adminApiToken !== undefined ? adminApiToken : "test-admin-token",
    probeApiToken: probeApiToken !== undefined ? probeApiToken : "probe-token",
  } as unknown as Env;
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
    const db = new RecordingSqlConnection()
      .when(LIST_SERVICES_SQL, () => [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          description: "Primary API",
          sort_order: 0,
          enabled: true,
          status: "operational",
          updated_at: "2026-04-27T00:00:00.000Z",
        },
      ])
      .when(LIST_COMPONENTS_SQL, () => [
        {
          id: "cmp_1",
          service_id: "svc_1",
          slug: "sub2api-public-api",
          name: "Public API",
          description: "Customer traffic",
          probe_type: "http",
          is_critical: true,
          sort_order: 0,
          enabled: true,
          observed_status: "operational",
          display_status: "operational",
          updated_at: "2026-04-27T00:00:00.000Z",
        },
      ]);
    const env = createEnv({ db });

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

  it("accepts lowercase bearer auth for admin routes", async () => {
    const db = new RecordingSqlConnection()
      .when(LIST_SERVICES_SQL, () => [])
      .when(LIST_COMPONENTS_SQL, () => []);

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog", {
        headers: { authorization: "bearer test-admin-token" },
      }),
      createEnv({ db }),
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ services: [] });
  });

  it("rejects admin auth when the configured token is unset", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog", {
        headers: { authorization: "Bearer " },
      }),
      createEnv({ adminApiToken: "" }),
      createCtx(),
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
  });

  it("returns 503 for catalog requests when the admin db contract is unavailable", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog", {
        headers: { authorization: "Bearer test-admin-token" },
      }),
      createEnv({
        db: {
          prepare() {
            throw new Error("legacy prepare should not be used");
          },
        },
      }),
      createCtx(),
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("admin database unavailable");
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
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000123");

    const db = new RecordingSqlConnection().when(INSERT_SERVICE_SQL, (params) => {
      expect(params).toEqual([
        "00000000-0000-4000-8000-000000000123",
        "sub2api-core",
        "Sub2API Core",
        "Primary API",
        2,
        false,
        "degraded",
        "2026-04-27T10:00:00.000Z",
      ]);

      return [{ id: "00000000-0000-4000-8000-000000000123" }];
    });
    const env = createEnv({ db });

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
      db,
      "2026-04-27T10:00:00.000Z",
    );
  });

  it("returns 409 when service create hits a duplicate slug conflict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000123");

    const env = createEnv({
      db: new RecordingSqlConnection().when(INSERT_SERVICE_SQL, () => {
        throw new Error(
          'duplicate key value violates unique constraint "services_slug_key"',
        );
      }),
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

    const db = new RecordingSqlConnection().when(UPDATE_SERVICE_SQL, (params) => {
      expect(params).toEqual([
        "sub2api-core",
        "Sub2API Core",
        "Renamed primary API",
        3,
        false,
        "2026-04-27T11:00:00.000Z",
        "sub2api",
      ]);

      return [{ id: "svc_1" }];
    });
    const env = createEnv({ db });

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
      db: new RecordingSqlConnection().when(UPDATE_SERVICE_SQL, () => {
        throw new Error(
          'duplicate key value violates unique constraint "services_slug_key"',
        );
      }),
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

  it("returns 404 for a service patch path with an empty slug", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "ignored" }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });

  it("returns 404 for a service patch path with extra segments", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/services/sub2api/extra", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "ignored" }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });

  it("returns 404 for unsupported admin patch paths", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ignored: true }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });

  it("returns 404 for the bare admin patch path", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ignored: true }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });

  it("creates a component under an existing service", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000456");

    const db = new RecordingSqlConnection().when(INSERT_COMPONENT_SQL, (params) => {
      expect(params).toEqual([
        "00000000-0000-4000-8000-000000000456",
        "sub2api-health",
        "Health",
        "Health endpoint",
        "http",
        true,
        30,
        true,
        "2026-04-27T12:00:00.000Z",
        "sub2api",
      ]);

      return [{ id: "00000000-0000-4000-8000-000000000456" }];
    });
    const env = createEnv({ db });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/components", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceSlug: "sub2api",
          slug: "sub2api-health",
          name: "Health",
          description: "Health endpoint",
          probeType: "http",
          isCritical: true,
          sortOrder: 30,
          enabled: true,
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
  });

  it("updates a component and recomputes the public snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:30:00.000Z"));

    const db = new RecordingSqlConnection().when(UPDATE_COMPONENT_SQL, (params) => {
      expect(params).toEqual([
        "sub2api-healthz",
        "Healthz",
        "Renamed health endpoint",
        "tcp",
        false,
        40,
        false,
        "2026-04-27T12:30:00.000Z",
        "sub2api-health",
      ]);

      return [{ id: "cmp_1" }];
    });
    const env = createEnv({ db });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/components/sub2api-health", {
        method: "PATCH",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "sub2api-healthz",
          name: "Healthz",
          description: "Renamed health endpoint",
          probeType: "tcp",
          isCritical: false,
          sortOrder: 40,
          enabled: false,
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: true });
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      db,
      "2026-04-27T12:30:00.000Z",
    );
  });

  it("returns 400 for invalid component payloads", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/components", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceSlug: "sub2api",
          slug: "bad/slug",
          name: "Health",
          probeType: "invalid",
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
  });

  it("returns 409 when component create hits a duplicate slug conflict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000456");

    const env = createEnv({
      db: new RecordingSqlConnection().when(INSERT_COMPONENT_SQL, () => {
        throw new Error(
          'duplicate key value violates unique constraint "components_slug_key"',
        );
      }),
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/components", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceSlug: "sub2api",
          slug: "sub2api-health",
          name: "Health",
          probeType: "http",
          isCritical: true,
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("component slug already exists");
    expect(recomputePublicStatus).not.toHaveBeenCalled();
  });

  it("returns 503 for admin writes when the admin db contract is unavailable", async () => {
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
      createEnv({
        db: {
          prepare() {
            throw new Error("legacy prepare should not be used");
          },
        },
      }),
      createCtx(),
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("admin database unavailable");
    expect(recomputePublicStatus).not.toHaveBeenCalled();
  });

  it("reorders services and components in one request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T13:00:00.000Z"));

    const db = new RecordingSqlConnection()
      .when(UPDATE_SERVICE_ORDER_SQL, () => [])
      .when(UPDATE_COMPONENT_ORDER_SQL, () => []);
    const env = createEnv({ db });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog/reorder", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          services: [{ slug: "sub2api", sortOrder: 20 }],
          components: [{ slug: "sub2api-postgres", sortOrder: 10 }],
        }),
      }),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: true });
    expect(
      db.log.map((entry) => ({
        sql: normalizeSql(entry.query),
        params: entry.params,
      })),
    ).toEqual([
      {
        sql: normalizeSql(UPDATE_SERVICE_ORDER_SQL),
        params: [20, "2026-04-27T13:00:00.000Z", "sub2api"],
      },
      {
        sql: normalizeSql(UPDATE_COMPONENT_ORDER_SQL),
        params: [10, "2026-04-27T13:00:00.000Z", "sub2api-postgres"],
      },
    ]);
  });

  it("returns 400 for invalid reorder payloads", async () => {
    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/admin/catalog/reorder", {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          services: [{ slug: "sub2api", sortOrder: "high" }],
          components: [],
        }),
      }),
      createEnv(),
      createCtx(),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("invalid payload");
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
      db: new RecordingSqlConnection().when(OVERRIDE_SQL, (params) => {
        expect(params?.[1]).toBe("component");
        expect(params?.[2]).toBe("degraded");
        expect(params?.[3]).toBe("Increased latency under investigation");
        expect(params?.[4]).toBeNull();
        expect(params?.[5]).toBeNull();
        expect(params?.[7]).toBe("missing-component");

        return [];
      }),
    });

    const response = await worker.fetch(request, env, createCtx());

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("target not found");
  });

  it("stores an operator-issued component override", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000789");

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
      db: new RecordingSqlConnection().when(OVERRIDE_SQL, (params) => {
        expect(params).toEqual([
          "00000000-0000-4000-8000-000000000789",
          "component",
          "degraded",
          "Increased latency under investigation",
          "2026-04-27T08:00:00.000Z",
          "2026-04-27T10:00:00.000Z",
          "2026-04-27T08:00:00.000Z",
          "sub2api-public-api",
        ]);

        runCalled = true;
        return [{ id: "00000000-0000-4000-8000-000000000789" }];
      }),
    });

    const response = await worker.fetch(request, env, createCtx());

    expect(runCalled).toBe(true);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      (env as Env & { db: RecordingSqlConnection }).db,
      "2026-04-27T08:00:00.000Z",
    );
  });

  it("returns 201 after an override insert even if recompute fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000789");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const defer = vi.fn(async (promise: Promise<unknown>) => {
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
      db: new RecordingSqlConnection().when(OVERRIDE_SQL, () => [
        { id: "00000000-0000-4000-8000-000000000789" },
      ]),
    });
    const ctx = {
      defer,
      passThroughOnException() {},
      props: {},
    } as RuntimeContext & { defer: typeof defer };

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
    expect(defer).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "failed to recompute public status after admin override insert",
      expect.any(Error),
    );
  });

  it("stores an announcement and recomputes the public snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T08:30:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000abc");

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
      db: new RecordingSqlConnection().when(ANNOUNCEMENT_SQL, (params) => {
        expect(params).toEqual([
          "00000000-0000-4000-8000-000000000abc",
          "Scheduled maintenance",
          "API traffic may be intermittently unavailable.",
          "partial_outage",
          "2026-04-27T08:30:00.000Z",
          "2026-04-27T09:30:00.000Z",
          "2026-04-27T08:30:00.000Z",
        ]);

        runCalled = true;
        return [{ id: "00000000-0000-4000-8000-000000000abc" }];
      }),
    });

    const response = await worker.fetch(request, env, createCtx());

    expect(runCalled).toBe(true);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ created: true });
    expect(recomputePublicStatus).toHaveBeenCalledWith(
      (env as Env & { db: RecordingSqlConnection }).db,
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

describe("db probe result query", () => {
  it("uses insertion metadata as the stable tie-break when checked_at is identical", async () => {
    const rows = [
      {
        id: "probe-latest",
        component_id: "cmp_1",
        probe_source: "probe-a",
        status: "major_outage",
        latency_ms: 900,
        http_code: 503,
        summary: "later insert",
        raw_payload: "{}",
        checked_at: "2026-04-27T10:00:00.000Z",
      },
    ];
    const db = new RecordingSqlConnection().when(
      LIST_LATEST_PROBE_RESULTS_SQL,
      () => rows,
    );

    await expect(listLatestProbeResults(db)).resolves.toEqual(rows);
    expect(normalizeSql(db.log[0]?.query ?? "")).toBe(
      normalizeSql(LIST_LATEST_PROBE_RESULTS_SQL),
    );
  });
});

describe("db active override query", () => {
  it("uses insertion metadata as the stable tie-break when created_at is identical", async () => {
    const rows = [
      {
        id: "ovr-latest",
        target_type: "component",
        target_id: "cmp_1",
        override_status: "major_outage",
        message: "later insert",
        starts_at: null,
        ends_at: null,
        created_by: "operator",
        created_at: "2026-04-27T10:00:00.000Z",
      },
    ];
    const db = new RecordingSqlConnection().when(LIST_ACTIVE_OVERRIDES_SQL, () => rows);

    await expect(
      listActiveOverrides(db, "2026-04-27T10:00:00.000Z"),
    ).resolves.toEqual(rows);
    expect(normalizeSql(db.log[0]?.query ?? "")).toBe(
      normalizeSql(LIST_ACTIVE_OVERRIDES_SQL),
    );
  });
});
