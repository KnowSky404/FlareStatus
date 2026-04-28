import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";
import * as dbModule from "../lib/db";
import type {
  AnnouncementRow,
  ComponentRow,
  OverrideRow,
  ProbeResultRow,
  ServiceRow,
} from "../types";
import worker from "../worker";

vi.mock("../lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/db")>();

  return {
    ...actual,
    listServicesWithComponents: vi.fn(),
    listLatestProbeResults: vi.fn(),
    persistStatusUpdates: vi.fn(),
  };
});

interface PublicStatusPayload {
  generatedAt: string;
  summary: { status: string };
  announcements: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  services: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    components: Array<{
      id: string;
      serviceId: string;
      slug: string;
      name: string;
      displayStatus: string;
    }>;
  }>;
}

function createEnv(
  input:
    | unknown
    | {
        snapshot?: unknown;
        db?: D1Database;
        kvPut?: (key: string, value: string) => Promise<void>;
      } = {},
): Env {
  if (input === undefined) {
    input = {};
  }

  const options =
    input &&
    typeof input === "object" &&
    (Object.keys(input).length === 0 ||
      "snapshot" in input ||
      "db" in input ||
      "kvPut" in input)
      ? (input as {
          snapshot?: unknown;
          db?: D1Database;
          kvPut?: (key: string, value: string) => Promise<void>;
        })
      : { snapshot: input };
  const { snapshot, db, kvPut } = options;

  return {
    ASSETS: ({
      fetch: async (_request) =>
        new Response("<html>status shell</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    } as Fetcher),
    DB: db ?? ({} as D1Database),
    STATUS_SNAPSHOTS: ({
      get: async (key: string, options?: KVNamespaceGetOptions<"json">) => {
        expect(key).toBe("public:current");
        expect(options).toEqual({ type: "json" });

        return snapshot ?? null;
      },
      put: kvPut,
    } as KVNamespace),
    PROBE_API_TOKEN: "probe-token",
    ADMIN_API_TOKEN: "admin-token",
  };
}

function createCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  };
}

const publicAppScript = readFileSync("public/app.js", "utf8");
const AsyncFunction = async function () {}.constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

interface MockElement {
  textContent: string;
  innerHTML: string;
}

async function runPublicApp({
  fetchImpl,
  summaryEl = {
    textContent: "Loading current system status...",
    innerHTML: "",
  },
  announcementListEl = { textContent: "", innerHTML: "" },
  serviceListEl = { textContent: "", innerHTML: "" },
}: {
  fetchImpl: typeof fetch;
  summaryEl?: MockElement | null;
  announcementListEl?: MockElement | null;
  serviceListEl?: MockElement | null;
}) {
  const elementsBySelector = new Map<string, MockElement | null>([
    ["#summary", summaryEl],
    ["#announcement-list", announcementListEl],
    ["#service-list", serviceListEl],
  ]);

  const querySelector = (selector: string) => {
    if (!elementsBySelector.has(selector)) {
      throw new Error(`Unexpected selector: ${selector}`);
    }

    return elementsBySelector.get(selector) ?? null;
  };

  const runScript = new AsyncFunction(
    "fetch",
    "document",
    publicAppScript,
  );

  await runScript(fetchImpl, { querySelector });

  return {
    summaryEl,
    announcementListEl,
    serviceListEl,
  };
}

const listServicesWithComponents = vi.mocked(dbModule.listServicesWithComponents);
const listLatestProbeResults = vi.mocked(dbModule.listLatestProbeResults);
const persistStatusUpdates = vi.mocked(dbModule.persistStatusUpdates);

function createServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: "svc_1",
    slug: "api",
    name: "API",
    description: "",
    sort_order: 0,
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

function createTimedWindowDb({
  overrides,
  announcements,
}: {
  overrides: OverrideRow[];
  announcements: AnnouncementRow[];
}): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => {
          const [startsAtBoundary, endsAtBoundary] = params as [string, string];

          if (sql.includes("FROM overrides")) {
            return {
              results: overrides
                .filter(
                  (row) =>
                    (row.starts_at === null || row.starts_at <= startsAtBoundary) &&
                    (row.ends_at === null || row.ends_at > endsAtBoundary),
                )
                .sort((left, right) =>
                  right.created_at.localeCompare(left.created_at),
                ),
            };
          }

          if (sql.includes("FROM announcements")) {
            return {
              results: announcements
                .filter(
                  (row) =>
                    (row.starts_at === null || row.starts_at <= startsAtBoundary) &&
                    (row.ends_at === null || row.ends_at > endsAtBoundary),
                )
                .sort((left, right) =>
                  right.created_at.localeCompare(left.created_at),
                ),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    }),
  } as D1Database;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  listServicesWithComponents.mockResolvedValue({
    services: [createServiceRow()],
    components: [createComponentRow()],
  });
  listLatestProbeResults.mockResolvedValue([createProbeResultRow()]);
  persistStatusUpdates.mockResolvedValue(undefined);
});

describe("worker asset shell", () => {
  it("returns the static shell for the homepage", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://flarestatus.test/"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("status shell");
  });
});

describe("public status route", () => {
  it("returns the current public snapshot from KV", async () => {
    const env = createEnv({
      generatedAt: "2026-04-27T10:00:00.000Z",
      summary: { status: "degraded" },
      announcements: [
        {
          id: "ann_1",
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
        },
      ],
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          status: "degraded",
          components: [
            {
              id: "cmp_1",
              serviceId: "svc_1",
              slug: "sub2api-health",
              name: "Sub2API Health",
              displayStatus: "degraded",
            },
          ],
        },
      ],
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/public/status"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as PublicStatusPayload;

    expect(payload).toMatchObject({
      generatedAt: "2026-04-27T10:00:00.000Z",
      summary: { status: "degraded" },
      announcements: [
        {
          id: "ann_1",
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
        },
      ],
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          status: "degraded",
          components: [
            {
              id: "cmp_1",
              serviceId: "svc_1",
              slug: "sub2api-health",
              name: "Sub2API Health",
              displayStatus: "degraded",
            },
          ],
        },
      ],
    });
    expect(payload.services).toHaveLength(1);
    expect(payload.services[0]).toHaveProperty("id");
    expect(payload.services[0]).toHaveProperty("name");
    expect(payload.services[0]).toHaveProperty("status");
    expect(payload.services[0]?.components).toHaveLength(1);
    expect(payload.services[0]?.components[0]).toHaveProperty("id");
    expect(payload.services[0]?.components[0]).toHaveProperty("serviceId");
    expect(payload.services[0]?.components[0]).toHaveProperty("name");
  });

  it("returns the full fallback contract when KV is empty", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/public/status"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as PublicStatusPayload;

    expect(payload.generatedAt).toBeTypeOf("string");
    expect(payload.summary).toEqual({ status: "operational" });
    expect(payload.announcements).toEqual([]);
    expect(payload.services).toEqual([]);
  });

  it("recomputes timed windows on public reads before falling back to KV", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T10:45:00.000Z"));
    const kvPut = vi.fn(async () => undefined);

    const env = createEnv({
      snapshot: {
        generatedAt: "2026-04-27T10:00:00.000Z",
        summary: { status: "operational" },
        announcements: [],
        services: [],
      },
      db: createTimedWindowDb({
        overrides: [],
        announcements: [
          createAnnouncementRow({
            id: "ann_future",
            title: "Scheduled maintenance",
            body: "API traffic may be intermittently unavailable.",
            starts_at: "2026-04-27T10:30:00.000Z",
            ends_at: "2026-04-27T11:30:00.000Z",
            created_at: "2026-04-27T10:15:00.000Z",
          }),
        ],
      }),
      kvPut,
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/public/status"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generatedAt: "2026-04-27T10:45:00.000Z",
      announcements: [
        {
          id: "ann_future",
          title: "Scheduled maintenance",
          body: "API traffic may be intermittently unavailable.",
        },
      ],
    });
    expect(kvPut).toHaveBeenCalledTimes(1);
  });
});

describe("public status shell", () => {
  it("includes summary, services, and announcements regions", () => {
    const html = readFileSync("public/index.html", "utf8");
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="services"');
    expect(html).toContain('id="announcements"');
    expect(html).toContain('id="announcement-list"');
    expect(html).toContain('id="service-list"');
    expect(html).toContain("Announcements");
    expect(html).toContain("No active announcements.");
    expect(html).toContain("Services");
    expect(html).toContain("Service details will appear here soon.");
  });

  it("fetches the public status endpoint and defines a summary fallback", () => {
    expect(publicAppScript).toContain('/api/public/status');
    expect(publicAppScript).toContain("Unable to load current system status");
  });

  it("updates the summary from the fetched status snapshot", async () => {
    const { summaryEl } = await runPublicApp({
      fetchImpl: async (input: RequestInfo | URL) => {
        expect(input).toBe("/api/public/status");

        return {
          ok: true,
          json: async () => ({ summary: { status: "operational" } }),
        } as Response;
      },
    });

    expect(summaryEl?.textContent).toBe("All Systems Operational");
  });

  it("renders announcements and service/component details from the fetched snapshot", async () => {
    const { announcementListEl, serviceListEl } = await runPublicApp({
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => ({
            summary: { status: "partial_outage" },
            announcements: [
              {
                id: "ann_1",
                title: "Latency incident",
                body: "Investigating elevated latency",
              },
            ],
            services: [
              {
                id: "svc_1",
                slug: "sub2api",
                name: "Sub2API",
                status: "partial_outage",
                components: [
                  {
                    id: "cmp_1",
                    serviceId: "svc_1",
                    slug: "redis",
                    name: "Redis",
                    displayStatus: "degraded",
                  },
                ],
              },
            ],
          }),
        }) as Response,
    });

    expect(announcementListEl?.innerHTML).toContain("Latency incident");
    expect(announcementListEl?.innerHTML).toContain("Investigating elevated latency");
    expect(serviceListEl?.innerHTML).toContain("Sub2API");
    expect(serviceListEl?.innerHTML).toContain("Redis");
    expect(serviceListEl?.innerHTML).toContain("Partial outage");
    expect(serviceListEl?.innerHTML).toContain("Degraded performance");
  });

  it("uses readable non-operational summary wording for degraded states", async () => {
    const partialOutage = await runPublicApp({
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => ({ summary: { status: "partial_outage" } }),
        }) as Response,
    });
    expect(partialOutage.summaryEl?.textContent).toBe("Partial outage");

    const degraded = await runPublicApp({
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => ({ summary: { status: "degraded" } }),
        }) as Response,
    });
    expect(degraded.summaryEl?.textContent).toBe("Degraded performance");

    const majorOutage = await runPublicApp({
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => ({ summary: { status: "major_outage" } }),
        }) as Response,
    });
    expect(majorOutage.summaryEl?.textContent).toBe("Major outage");
  });

  it("falls back when the status request fails", async () => {
    const { summaryEl } = await runPublicApp({
      fetchImpl: async () => {
        throw new Error("network failed");
      },
    });

    expect(summaryEl?.textContent).toBe("Unable to load current system status");
  });

  it("does nothing when the summary element is missing", async () => {
    const result = await runPublicApp({
      fetchImpl: async () => {
        throw new Error("should not be reached");
      },
      summaryEl: null,
    });

    expect(result.summaryEl).toBeNull();
  });
});

describe("public snapshot recomputation", () => {
  it("applies only active timed overrides and keeps announcement title shape", async () => {
    const nowIso = "2026-04-27T10:00:00.000Z";
    const kvPut = vi.fn();

    const snapshot = await recomputePublicStatus(
      createTimedWindowDb({
        overrides: [
          createOverrideRow({
            id: "ovr_active",
            override_status: "degraded",
            starts_at: "2026-04-27T09:00:00.000Z",
            ends_at: "2026-04-27T11:00:00.000Z",
            created_at: "2026-04-27T09:45:00.000Z",
          }),
          createOverrideRow({
            id: "ovr_future",
            override_status: "major_outage",
            starts_at: "2026-04-27T10:30:00.000Z",
            ends_at: "2026-04-27T11:30:00.000Z",
            created_at: "2026-04-27T09:50:00.000Z",
          }),
        ],
        announcements: [
          createAnnouncementRow({
            id: "ann_active",
            title: "Scheduled maintenance",
            body: "API traffic may be intermittently unavailable.",
            starts_at: "2026-04-27T09:00:00.000Z",
            ends_at: "2026-04-27T11:00:00.000Z",
          }),
          createAnnouncementRow({
            id: "ann_expired",
            title: "Expired maintenance",
            body: "This should not be visible.",
            starts_at: "2026-04-27T07:00:00.000Z",
            ends_at: "2026-04-27T09:00:00.000Z",
          }),
        ],
      }),
      { put: kvPut } as unknown as KVNamespace,
      nowIso,
    );

    expect(persistStatusUpdates).toHaveBeenCalledWith(
      expect.anything(),
      {
        componentRows: [
          {
            id: "cmp_1",
            observedStatus: "operational",
            displayStatus: "degraded",
          },
        ],
        serviceRows: [{ id: "svc_1", status: "degraded" }],
      },
      nowIso,
    );

    expect(snapshot.announcements).toEqual([
      {
        id: "ann_active",
        title: "Scheduled maintenance",
        body: "API traffic may be intermittently unavailable.",
      },
    ]);
    expect(snapshot.services[0]?.components[0]?.displayStatus).toBe("degraded");
    expect(JSON.parse(kvPut.mock.calls[0][1] as string).announcements[0]).toEqual(
      {
        id: "ann_active",
        title: "Scheduled maintenance",
        body: "API traffic may be intermittently unavailable.",
      },
    );
  });
});
