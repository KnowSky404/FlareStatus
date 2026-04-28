import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnnouncementRow,
  ComponentRow,
  OverrideRow,
  ProbeResultRow,
  ServiceRow,
} from "../types";
import { recomputePublicStatus } from "../lib/status-engine";
import * as dbModule from "../lib/db";

vi.mock("../lib/db", () => ({
  listServicesWithComponents: vi.fn(),
  listLatestProbeResults: vi.fn(),
  listActiveOverrides: vi.fn(),
  listActiveAnnouncements: vi.fn(),
  persistStatusUpdates: vi.fn(),
}));

const listServicesWithComponents = vi.mocked(dbModule.listServicesWithComponents);
const listLatestProbeResults = vi.mocked(dbModule.listLatestProbeResults);
const listActiveOverrides = vi.mocked(dbModule.listActiveOverrides);
const listActiveAnnouncements = vi.mocked(dbModule.listActiveAnnouncements);
const persistStatusUpdates = vi.mocked(dbModule.persistStatusUpdates);

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

describe("recomputePublicStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    persistStatusUpdates.mockResolvedValue(undefined);
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

    const kvPut = vi.fn();

    await recomputePublicStatus(
      {} as D1Database,
      { put: kvPut } as unknown as KVNamespace,
      "2026-04-27T10:00:00.000Z",
    );

    expect(persistStatusUpdates).toHaveBeenCalledWith(
      expect.anything(),
      {
        componentRows: [
          {
            id: "cmp_1",
            observedStatus: "degraded",
            displayStatus: "major_outage",
          },
        ],
        serviceRows: [{ id: "svc_1", status: "major_outage" }],
      },
      "2026-04-27T10:00:00.000Z",
    );

    const snapshot = JSON.parse(kvPut.mock.calls[0][1] as string);

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

    const kvPut = vi.fn();

    await recomputePublicStatus(
      {} as D1Database,
      { put: kvPut } as unknown as KVNamespace,
      "2026-04-27T10:00:00.000Z",
    );

    expect(persistStatusUpdates).toHaveBeenCalledWith(
      expect.anything(),
      {
        componentRows: [
          {
            id: "cmp_1",
            observedStatus: "partial_outage",
            displayStatus: "partial_outage",
          },
        ],
        serviceRows: [{ id: "svc_1", status: "partial_outage" }],
      },
      "2026-04-27T10:00:00.000Z",
    );

    const snapshot = JSON.parse(kvPut.mock.calls[0][1] as string);

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

    const kvPut = vi.fn();

    await recomputePublicStatus(
      {} as D1Database,
      { put: kvPut } as unknown as KVNamespace,
      "2026-04-27T10:00:00.000Z",
    );

    const snapshot = JSON.parse(kvPut.mock.calls[0][1] as string);

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

    const kvPut = vi.fn();

    await recomputePublicStatus(
      {} as D1Database,
      { put: kvPut } as unknown as KVNamespace,
      "2026-04-27T10:00:00.000Z",
    );

    expect(persistStatusUpdates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        componentRows: [
          {
            id: "cmp_1",
            observedStatus: "operational",
            displayStatus: "operational",
          },
        ],
      }),
      "2026-04-27T10:00:00.000Z",
    );

    const snapshot = JSON.parse(kvPut.mock.calls[0][1] as string);

    expect(snapshot.services[0]?.components[0]?.displayStatus).toBe(
      "operational",
    );
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

    const kvPut = vi.fn();

    const snapshot = await recomputePublicStatus(
      {} as D1Database,
      { put: kvPut } as unknown as KVNamespace,
      "2026-04-28T00:00:00.000Z",
    );

    expect(
      snapshot.services[0]?.components.some(
        (component) => component.slug === "public-api",
      ),
    ).toBe(false);
  });
});
