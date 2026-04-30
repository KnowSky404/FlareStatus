import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../lib/env";
import type { SqlConnection, SqlValue } from "../lib/sql";
import type {
  AnnouncementRow,
  ComponentRow,
  OverrideRow,
  PublicSnapshot,
  ProbeResultRow,
  ServiceRow,
} from "../types";
import { recomputePublicStatus } from "../lib/status-engine";
import * as dbModule from "../lib/db";
import { normalizeSql, RecordingSqlConnection } from "./helpers/postgres";
import {
  CURRENT_PUBLIC_SNAPSHOT_KEY,
  loadPublicSnapshot,
} from "../lib/snapshots";

vi.mock("../lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/db")>();

  return {
    ...actual,
    listServicesWithComponents: vi.fn(),
    listLatestProbeResults: vi.fn(),
    listActiveOverrides: vi.fn(),
    listActiveAnnouncements: vi.fn(),
  };
});

const listServicesWithComponents = vi.mocked(dbModule.listServicesWithComponents);
const listLatestProbeResults = vi.mocked(dbModule.listLatestProbeResults);
const listActiveOverrides = vi.mocked(dbModule.listActiveOverrides);
const listActiveAnnouncements = vi.mocked(dbModule.listActiveAnnouncements);
const UPSERT_PUBLIC_SNAPSHOT_SQL = `INSERT INTO public_snapshots (key, payload, generated_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   generated_at = EXCLUDED.generated_at,
                   updated_at = EXCLUDED.updated_at`;

const LOAD_PUBLIC_SNAPSHOT_SQL = `SELECT payload::text AS payload
     FROM public_snapshots
     WHERE key = $1
     LIMIT 1`;

const UPDATE_COMPONENT_STATUS_SQL = `UPDATE components
            SET observed_status = $1, display_status = $2, updated_at = $3
            WHERE id = $4`;

const UPDATE_SERVICE_STATUS_SQL = `UPDATE services
            SET status = $1, updated_at = $2
            WHERE id = $3`;

function createServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: "svc_1",
    slug: "api",
    name: "API",
    description: "",
    sort_order: 0,
    enabled: 1,
    status: "operational",
    updated_at: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}

function createComponentRow(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: "cmp_1",
    service_id: "svc_1",
    slug: "gateway",
    name: "Gateway",
    description: "",
    probe_type: "http",
    is_critical: 1,
    sort_order: 0,
    enabled: 1,
    observed_status: "operational",
    display_status: "operational",
    updated_at: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}

function createProbeResultRow(
  overrides: Partial<ProbeResultRow> = {},
): ProbeResultRow {
  return {
    id: "probe_1",
    component_id: "cmp_1",
    probe_source: "probe-a",
    status: "operational",
    latency_ms: 120,
    http_code: 200,
    summary: "",
    raw_payload: "{}",
    checked_at: "2026-04-27T10:00:00.000Z",
    ...overrides,
  };
}

function createOverrideRow(overrides: Partial<OverrideRow> = {}): OverrideRow {
  return {
    id: "ovr_1",
    target_type: "component",
    target_id: "cmp_1",
    override_status: "major_outage",
    message: "Operator override",
    starts_at: null,
    ends_at: null,
    created_by: "operator",
    created_at: "2026-04-27T09:00:00.000Z",
    ...overrides,
  };
}

function createAnnouncementRow(
  overrides: Partial<AnnouncementRow> = {},
): AnnouncementRow {
  return {
    id: "ann_1",
    title: "Latency incident",
    body: "Investigating elevated latency.",
    status_level: "degraded",
    starts_at: null,
    ends_at: null,
    created_at: "2026-04-27T09:30:00.000Z",
    ...overrides,
  };
}

function createDb(): AppDatabase {
  const snapshots = new Map<string, string>();

  return new RecordingSqlConnection()
    .when(UPDATE_COMPONENT_STATUS_SQL, () => [])
    .when(UPDATE_SERVICE_STATUS_SQL, () => [])
    .when(UPSERT_PUBLIC_SNAPSHOT_SQL, (params) => {
      const [key, payload] = params as [string, unknown, string];
      snapshots.set(key, JSON.stringify(payload));
      return [];
    })
    .when(LOAD_PUBLIC_SNAPSHOT_SQL, (params) => {
      const [key] = params as [string];
      const payload = snapshots.get(key);

      return payload ? [{ payload }] : [];
    });
}

function createTransactionAwareDb() {
  const snapshots = new Map<string, string>();
  const transactionLog: string[] = [];
  let beginCount = 0;

  const connection: SqlConnection = {
    async unsafe<T = unknown>(query: string, params?: readonly SqlValue[]) {
      const normalizedQuery = normalizeSql(query);
      transactionLog.push(normalizedQuery);

      if (normalizedQuery === normalizeSql(UPSERT_PUBLIC_SNAPSHOT_SQL)) {
        const [key, payload] = params as [string, unknown, string];
        snapshots.set(key, JSON.stringify(payload));
        return [] as T;
      }

      if (normalizedQuery === normalizeSql(LOAD_PUBLIC_SNAPSHOT_SQL)) {
        const [key] = params as [string];
        const payload = snapshots.get(key);
        return (payload ? [{ payload }] : []) as T;
      }

      if (
        normalizedQuery ===
          normalizeSql(`UPDATE components
            SET observed_status = $1, display_status = $2, updated_at = $3
            WHERE id = $4`) ||
        normalizedQuery ===
          normalizeSql(`UPDATE services
            SET status = $1, updated_at = $2
            WHERE id = $3`)
      ) {
        return [] as T;
      }

      throw new Error(`Unexpected SQL: ${query}`);
    },
    async begin<T>(callback: (tx: SqlConnection) => Promise<T>) {
      beginCount += 1;
      return callback(connection);
    },
  };

  return {
    db: connection as AppDatabase,
    getBeginCount() {
      return beginCount;
    },
    getTransactionLog() {
      return transactionLog;
    },
  };
}

describe("recomputePublicStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listActiveAnnouncements.mockResolvedValue([]);
  });

  it("recomputes a component display status from latest probe result and active override", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({ status: "degraded" }),
    ]);
    listActiveOverrides.mockResolvedValue([
      createOverrideRow({ override_status: "major_outage" }),
    ]);

    const db = createDb();

    await recomputePublicStatus(db, "2026-04-27T10:00:00.000Z");

    expect((db as RecordingSqlConnection).log).toEqual(
      expect.arrayContaining([
        {
          query: UPDATE_COMPONENT_STATUS_SQL,
          params: [
            "degraded",
            "major_outage",
            "2026-04-27T10:00:00.000Z",
            "cmp_1",
          ],
        },
        {
          query: UPDATE_SERVICE_STATUS_SQL,
          params: ["major_outage", "2026-04-27T10:00:00.000Z", "svc_1"],
        },
      ]),
    );

    const snapshot = (await loadPublicSnapshot(
      db,
      CURRENT_PUBLIC_SNAPSHOT_KEY,
    )) as PublicSnapshot;

    expect(snapshot.services[0]?.components[0]?.displayStatus).toBe(
      "major_outage",
    );
  });

  it("promotes service status to partial_outage when a critical component is partial_outage", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({ status: "partial_outage" }),
    ]);
    listActiveOverrides.mockResolvedValue([]);

    const db = createDb();

    await recomputePublicStatus(db, "2026-04-27T10:00:00.000Z");

    expect((db as RecordingSqlConnection).log).toEqual(
      expect.arrayContaining([
        {
          query: UPDATE_COMPONENT_STATUS_SQL,
          params: [
            "partial_outage",
            "partial_outage",
            "2026-04-27T10:00:00.000Z",
            "cmp_1",
          ],
        },
        {
          query: UPDATE_SERVICE_STATUS_SQL,
          params: ["partial_outage", "2026-04-27T10:00:00.000Z", "svc_1"],
        },
      ]),
    );

    const snapshot = (await loadPublicSnapshot(
      db,
      CURRENT_PUBLIC_SNAPSHOT_KEY,
    )) as PublicSnapshot;

    expect(snapshot.services[0]?.status).toBe("partial_outage");
  });

  it("uses the highest service severity for the top-level summary", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [
        createServiceRow(),
        createServiceRow({
          id: "svc_2",
          slug: "jobs",
          name: "Jobs",
          sort_order: 1,
        }),
      ],
      components: [
        createComponentRow({
          id: "cmp_1",
          service_id: "svc_1",
          slug: "gateway",
          name: "Gateway",
        }),
        createComponentRow({
          id: "cmp_2",
          service_id: "svc_2",
          slug: "workers",
          name: "Workers",
        }),
      ],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({
        component_id: "cmp_1",
        status: "major_outage",
      }),
      createProbeResultRow({
        id: "probe_2",
        component_id: "cmp_2",
        status: "partial_outage",
      }),
    ]);
    listActiveOverrides.mockResolvedValue([]);
    listActiveAnnouncements.mockResolvedValue([createAnnouncementRow()]);

    const db = createDb();

    await recomputePublicStatus(db, "2026-04-27T10:00:00.000Z");

    const snapshot = (await loadPublicSnapshot(
      db,
      CURRENT_PUBLIC_SNAPSHOT_KEY,
    )) as PublicSnapshot;

    expect(snapshot.summary.status).toBe("major_outage");
  });

  it("keeps the first row when duplicate probe rows share the same checkedAt", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({
        id: "probe_b",
        status: "operational",
        checked_at: "2026-04-27T10:00:00.000Z",
      }),
      createProbeResultRow({
        id: "probe_a",
        status: "major_outage",
        checked_at: "2026-04-27T10:00:00.000Z",
      }),
    ]);
    listActiveOverrides.mockResolvedValue([]);

    const db = createDb();

    await recomputePublicStatus(db, "2026-04-27T10:00:00.000Z");

    expect((db as RecordingSqlConnection).log).toEqual(
      expect.arrayContaining([
        {
          query: UPDATE_COMPONENT_STATUS_SQL,
          params: [
            "operational",
            "operational",
            "2026-04-27T10:00:00.000Z",
            "cmp_1",
          ],
        },
      ]),
    );

    const snapshot = (await loadPublicSnapshot(
      db,
      CURRENT_PUBLIC_SNAPSHOT_KEY,
    )) as PublicSnapshot;

    expect(snapshot.services[0]?.components[0]?.displayStatus).toBe(
      "operational",
    );
  });

  it("treats probe rows as pre-ranked and keeps the first row for a component", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({
        id: "probe_first",
        status: "operational",
        checked_at: "2026-04-27T10:05:00.000Z",
      }),
      createProbeResultRow({
        id: "probe_second",
        status: "major_outage",
        checked_at: "2026-04-27T10:00:00.000Z",
      }),
    ]);
    listActiveOverrides.mockResolvedValue([]);

    const snapshot = await recomputePublicStatus(
      createDb(),
      "2026-04-27T10:10:00.000Z",
    );

    expect((snapshot as PublicSnapshot).services[0]?.components[0]?.displayStatus).toBe(
      "operational",
    );
  });

  it("persists status updates and the snapshot inside one transaction", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([
      createProbeResultRow({ status: "degraded" }),
    ]);
    listActiveOverrides.mockResolvedValue([]);

    const db = createTransactionAwareDb();

    await recomputePublicStatus(db.db, "2026-04-27T10:00:00.000Z");

    expect(db.getBeginCount()).toBe(1);
    expect(db.getTransactionLog()).toEqual([
      normalizeSql(UPDATE_COMPONENT_STATUS_SQL),
      normalizeSql(UPDATE_SERVICE_STATUS_SQL),
      normalizeSql(UPSERT_PUBLIC_SNAPSHOT_SQL),
    ]);
  });

  it("ignores disabled components when building the public snapshot", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [
        createComponentRow(),
        {
          ...createComponentRow({
            id: "cmp_2",
            slug: "public-api",
            name: "Public API",
            sort_order: 1,
          }),
          enabled: 0,
        },
      ],
    });
    listLatestProbeResults.mockResolvedValue([]);
    listActiveOverrides.mockResolvedValue([]);

    const snapshot = await recomputePublicStatus(
      createDb(),
      "2026-04-28T00:00:00.000Z",
    );

    expect(
      snapshot.services[0]?.components.some(
        (component) => component.slug === "public-api",
      ),
    ).toBe(false);
  });

  it("omits disabled services from the public snapshot", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [
        createServiceRow(),
        createServiceRow({
          id: "svc_2",
          slug: "codex",
          name: "Codex",
          enabled: 0,
        }),
      ],
      components: [
        createComponentRow(),
        createComponentRow({
          id: "cmp_2",
          service_id: "svc_2",
          slug: "codex-health",
          name: "Codex Health",
        }),
      ],
    });
    listLatestProbeResults.mockResolvedValue([]);
    listActiveOverrides.mockResolvedValue([]);

    const snapshot = await recomputePublicStatus(
      createDb(),
      "2026-04-28T00:00:00.000Z",
    );

    expect(snapshot.services.some((service) => service.slug === "codex")).toBe(
      false,
    );
  });

  it("does not let disabled components affect service aggregation", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [
        createComponentRow({ observed_status: "operational" }),
        createComponentRow({
          id: "cmp_2",
          slug: "public-api",
          name: "Public API",
          sort_order: 1,
          enabled: 0,
          observed_status: "major_outage",
          display_status: "major_outage",
        }),
      ],
    });
    listLatestProbeResults.mockResolvedValue([]);
    listActiveOverrides.mockResolvedValue([]);

    const snapshot = await recomputePublicStatus(
      createDb(),
      "2026-04-28T00:00:00.000Z",
    );

    expect(snapshot.services.find((service) => service.slug === "api")?.status).toBe(
      "operational",
    );
  });

  it("upserts the current public snapshot into postgres", async () => {
    const db = createDb();
    const nowIso = "2026-04-29T10:00:00.000Z";

    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([createProbeResultRow()]);
    listActiveOverrides.mockResolvedValue([]);

    await recomputePublicStatus(db, nowIso);

    await expect(
      loadPublicSnapshot(db, CURRENT_PUBLIC_SNAPSHOT_KEY),
    ).resolves.toMatchObject({
      generatedAt: nowIso,
      summary: { status: "operational" },
    });
  });

  it("binds the public snapshot as a jsonb object instead of a json string", async () => {
    const db = createDb();
    const nowIso = "2026-04-29T10:00:00.000Z";

    listServicesWithComponents.mockResolvedValue({
      services: [createServiceRow()],
      components: [createComponentRow()],
    });
    listLatestProbeResults.mockResolvedValue([createProbeResultRow()]);
    listActiveOverrides.mockResolvedValue([]);

    await recomputePublicStatus(db, nowIso);

    const upsert = (db as RecordingSqlConnection).log.find(
      (entry) =>
        normalizeSql(entry.query) === normalizeSql(UPSERT_PUBLIC_SNAPSHOT_SQL),
    );

    expect(upsert?.params?.[1]).toMatchObject({
      generatedAt: nowIso,
      summary: { status: "operational" },
    });
  });
});
