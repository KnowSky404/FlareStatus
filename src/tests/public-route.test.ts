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
const adminAppScript = readFileSync("public/admin/app.js", "utf8");
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

function createMockElement(overrides: Record<string, unknown> = {}) {
  return {
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    className: "",
    listeners: new Map<string, Array<() => void>>(),
    addEventListener(type: string, listener: () => void) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(listener);
      this.listeners.set(type, handlers);
    },
    dispatch(type: string) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener();
      }
    },
    click() {
      this.dispatch("click");
    },
    getAttribute(_name?: string) {
      return null;
    },
    ...overrides,
  };
}

async function runAdminApp({
  fetchImpl,
  token = "test-admin-token",
}: {
  fetchImpl: typeof fetch;
  token?: string;
}) {
  const serviceName = createMockElement();
  const serviceSlug = createMockElement();
  const serviceDescription = createMockElement();
  const serviceSortOrder = createMockElement();
  const serviceEnabled = createMockElement();
  const serviceForm = createMockElement({
    querySelector(selector: string) {
      const map = new Map<string, ReturnType<typeof createMockElement>>([
        ["#service-name", serviceName],
        ["#service-slug", serviceSlug],
        ["#service-description", serviceDescription],
        ["#service-sort-order", serviceSortOrder],
        ["#service-enabled", serviceEnabled],
      ]);
      return map.get(selector) ?? null;
    },
  });

  const dynamicState = {
    serviceSelectButtons: [] as Array<ReturnType<typeof createMockElement>>,
    componentSaveButtons: [] as Array<ReturnType<typeof createMockElement>>,
    componentFieldsBySlug: new Map<string, Array<ReturnType<typeof createMockElement>>>(),
  };

  const serviceList = createMockElement({
    querySelectorAll(selector: string) {
      if (selector !== "[data-service-select]") {
        return [];
      }

      return dynamicState.serviceSelectButtons;
    },
  });

  const componentList = createMockElement({
    querySelectorAll(selector: string) {
      if (selector !== "[data-save-component]") {
        return [];
      }

      return dynamicState.componentSaveButtons;
    },
  });

  const adminStatus = createMockElement();
  const previewSummary = createMockElement();
  const previewService = createMockElement();
  const previewAnnouncements = createMockElement();
  const tokenInput = createMockElement({ value: token });
  const connectButton = createMockElement();
  const serviceSearch = createMockElement();
  const newServiceButton = createMockElement();
  const saveServiceButton = createMockElement();
  const newComponentButton = createMockElement();
  const overrideTargetType = createMockElement({ value: "service" });
  const overrideTargetSlug = createMockElement();
  const overrideStatus = createMockElement({ value: "degraded" });
  const overrideMessage = createMockElement();
  const submitOverrideButton = createMockElement();
  const announcementTitle = createMockElement();
  const announcementBody = createMockElement();
  const announcementStatus = createMockElement({ value: "operational" });
  const submitAnnouncementButton = createMockElement();

  Object.defineProperty(serviceList, "innerHTML", {
    get() {
      return this._innerHTML ?? "";
    },
    set(value: string) {
      this._innerHTML = value;
      dynamicState.serviceSelectButtons = Array.from(
        value.matchAll(/data-service-select="([^"]+)"/g),
      ).map((match) => createMockElement({ getAttribute: () => match[1] }));
    },
  });

  Object.defineProperty(componentList, "innerHTML", {
    get() {
      return this._innerHTML ?? "";
    },
    set(value: string) {
      this._innerHTML = value;
      dynamicState.componentSaveButtons = Array.from(
        value.matchAll(/data-save-component="([^"]+)"/g),
      ).map((match) => createMockElement({ getAttribute: () => match[1] }));

      dynamicState.componentFieldsBySlug = new Map();
      for (const slugMatch of value.matchAll(/data-component-row="([^"]+)"/g)) {
        const slug = slugMatch[1];
        const fields = [
          ["name", "New Component"],
          ["slug", slug],
          ["probeType", "http"],
          ["description", ""],
          ["sortOrder", "0"],
          ["enabled", "true"],
          ["isCritical", "false"],
        ].map(([field, initialValue]) =>
          createMockElement({
            value: initialValue,
            getAttribute(attribute: string) {
              if (attribute === "data-component-slug") {
                return slug;
              }

              if (attribute === "data-component-field") {
                return field;
              }

              return null;
            },
          }),
        );

        dynamicState.componentFieldsBySlug.set(slug, fields);
      }
    },
  });

  const elementsBySelector = new Map<string, ReturnType<typeof createMockElement> | null>([
    ["#admin-token", tokenInput],
    ["#connect-token", connectButton],
    ["#admin-status", adminStatus],
    ["#preview-summary", previewSummary],
    ["#preview-service", previewService],
    ["#preview-announcements", previewAnnouncements],
    ["#service-search", serviceSearch],
    ["#service-list", serviceList],
    ["#new-service", newServiceButton],
    ["#service-form", serviceForm],
    ["#save-service", saveServiceButton],
    ["#new-component", newComponentButton],
    ["#component-list", componentList],
    ["#override-target-type", overrideTargetType],
    ["#override-target-slug", overrideTargetSlug],
    ["#override-status", overrideStatus],
    ["#override-message", overrideMessage],
    ["#submit-override", submitOverrideButton],
    ["#announcement-title", announcementTitle],
    ["#announcement-body", announcementBody],
    ["#announcement-status", announcementStatus],
    ["#submit-announcement", submitAnnouncementButton],
  ]);

  const document = {
    querySelector(selector: string) {
      if (!elementsBySelector.has(selector)) {
        throw new Error(`Unexpected selector: ${selector}`);
      }

      return elementsBySelector.get(selector) ?? null;
    },
    querySelectorAll(selector: string) {
      const componentSlugMatch = selector.match(/^\[data-component-slug="([^"]+)"\]$/);

      if (!componentSlugMatch) {
        return [];
      }

      return dynamicState.componentFieldsBySlug.get(componentSlugMatch[1]) ?? [];
    },
  };

  const window = {
    localStorage: {
      getItem(key: string) {
        if (key === "flarestatus.adminToken") {
          return token;
        }

        return null;
      },
      setItem() {},
    },
  };

  const runScript = new AsyncFunction("fetch", "document", "window", adminAppScript);
  await runScript(fetchImpl, document, window);

  return {
    adminStatus,
    previewSummary,
    previewService,
    previewAnnouncements,
    serviceList,
    componentList,
    serviceName,
    serviceSlug,
    serviceDescription,
    serviceSortOrder,
    serviceEnabled,
    saveServiceButton,
    componentSaveButtons: dynamicState.componentSaveButtons,
    getComponentFields(componentSlug: string) {
      return dynamicState.componentFieldsBySlug.get(componentSlug) ?? [];
    },
    submitOverrideButton,
    submitAnnouncementButton,
    overrideTargetSlug,
    overrideMessage,
    announcementTitle,
    announcementBody,
  };
}

function createJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  } as Response;
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

  it("serves the admin shell at /admin", async () => {
    const env = {
      ...createEnv(),
      ASSETS: ({
        fetch: async (request: Request) =>
          new Response(new URL(request.url).pathname, {
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      } as Fetcher),
    };

    const response = await worker.fetch(
      new Request("https://flarestatus.test/admin"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("/admin/index.html");
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

  it("omits disabled services and components when recomputing the public route", async () => {
    listServicesWithComponents.mockResolvedValue({
      services: [
        createServiceRow({
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
        }),
        createServiceRow({
          id: "svc_2",
          slug: "codex",
          name: "Codex",
          sort_order: 1,
          enabled: 0,
        }),
      ],
      components: [
        createComponentRow({
          id: "cmp_1",
          service_id: "svc_1",
          slug: "sub2api-health",
          name: "Sub2API Health",
        }),
        createComponentRow({
          id: "cmp_2",
          service_id: "svc_1",
          slug: "redis",
          name: "Redis",
          sort_order: 1,
          enabled: 0,
          observed_status: "major_outage",
          display_status: "major_outage",
        }),
        createComponentRow({
          id: "cmp_3",
          service_id: "svc_2",
          slug: "codex-health",
          name: "Codex Health",
          sort_order: 0,
        }),
      ],
    });
    listLatestProbeResults.mockResolvedValue([]);

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/public/status"),
      createEnv({
        db: createTimedWindowDb({ overrides: [], announcements: [] }),
        kvPut: async () => undefined,
      }),
      createCtx(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as PublicStatusPayload;

    expect(payload).toMatchObject({
      services: [
        {
          slug: "sub2api",
          status: "operational",
          components: [
            {
              slug: "sub2api-health",
              displayStatus: "operational",
            },
          ],
        },
      ],
    });
    expect(payload.services).toHaveLength(1);
    expect(payload.services[0]?.components).toHaveLength(1);
    expect(payload.services[0]?.components[0]?.slug).toBe("sub2api-health");
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

describe("admin console shell", () => {
  const catalogPayload = {
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
            slug: "sub2api-health",
            name: "Health",
            description: "Health endpoint",
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
  };

  const publicPayload = {
    summary: { status: "operational" },
    announcements: [],
    services: [
      {
        id: "svc_1",
        slug: "sub2api",
        name: "Sub2API",
        status: "operational",
        components: [],
      },
    ],
  };

  it("loads the catalog and renders the selected service editor", async () => {
    const result = await runAdminApp({
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toBeDefined();
        const url = String(input);

        if (url === "/api/public/status") {
          return createJsonResponse(publicPayload);
        }

        expect(url).toBe("/api/admin/catalog");
        return createJsonResponse(catalogPayload);
      },
    });

    expect(result.adminStatus.textContent).toBe("Editable catalog loaded.");
    expect(result.serviceList.innerHTML).toContain('data-service-slug="sub2api"');
    expect(result.serviceName.value).toBe("Sub2API");
    expect(result.serviceSlug.value).toBe("sub2api");
    expect(result.componentList.innerHTML).toContain('data-component-row="sub2api-health"');
  });

  it("saves a service and refreshes the preview", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const result = await runAdminApp({
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (url === "/api/public/status") {
          return createJsonResponse(publicPayload);
        }

        if (url === "/api/admin/catalog") {
          return createJsonResponse(catalogPayload);
        }

        if (url === "/api/admin/services/sub2api" && method === "PATCH") {
          return createJsonResponse({ updated: true });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      },
    });

    result.serviceName.value = "Sub2API Core";
    result.serviceSlug.value = "sub2api-core";
    result.serviceDescription.value = "Renamed";
    result.serviceSortOrder.value = "3";
    result.serviceEnabled.checked = false;

    result.saveServiceButton.click();
    await Promise.resolve();
    await Promise.resolve();

    const patchCall = calls.find(
      (call) => call.url === "/api/admin/services/sub2api" && call.method === "PATCH",
    );

    expect(patchCall?.body).toContain('"slug":"sub2api-core"');
    expect(patchCall?.body).toContain('"name":"Sub2API Core"');
    expect(result.adminStatus.textContent).toBe("Saved service Sub2API Core");
  });

  it("saves a component via the inline editor", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const result = await runAdminApp({
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (url === "/api/public/status") {
          return createJsonResponse(publicPayload);
        }

        if (url === "/api/admin/catalog") {
          return createJsonResponse(catalogPayload);
        }

        if (url === "/api/admin/components/sub2api-health" && method === "PATCH") {
          return createJsonResponse({ updated: true });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      },
    });

    const componentFields = result.getComponentFields("sub2api-health");
    const nameField = componentFields.find(
      (field) => field.getAttribute("data-component-field") === "name",
    );
    const slugField = componentFields.find(
      (field) => field.getAttribute("data-component-field") === "slug",
    );

    expect(nameField).toBeDefined();
    expect(slugField).toBeDefined();

    nameField!.value = "Healthz";
    slugField!.value = "sub2api-healthz";

    result.componentSaveButtons[0]?.click();
    await Promise.resolve();
    await Promise.resolve();

    const patchCall = calls.find(
      (call) =>
        call.url === "/api/admin/components/sub2api-health" &&
        call.method === "PATCH",
    );

    expect(patchCall?.body).toContain('"name":"Healthz"');
    expect(patchCall?.body).toContain('"slug":"sub2api-healthz"');
    expect(result.adminStatus.textContent).toBe("Saved component Healthz");
  });

  it("submits overrides and announcements from the side rail", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const result = await runAdminApp({
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (url === "/api/public/status") {
          return createJsonResponse(publicPayload);
        }

        if (url === "/api/admin/catalog") {
          return createJsonResponse(catalogPayload);
        }

        if (url === "/api/admin/overrides" && method === "POST") {
          return createJsonResponse({ created: true });
        }

        if (url === "/api/admin/announcements" && method === "POST") {
          return createJsonResponse({ created: true });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      },
    });

    result.overrideTargetSlug.value = "sub2api";
    result.overrideMessage.value = "Manual degradation";
    result.submitOverrideButton.click();
    await Promise.resolve();
    await Promise.resolve();

    const overrideCall = calls.find(
      (call) => call.url === "/api/admin/overrides" && call.method === "POST",
    );
    expect(overrideCall?.body).toContain('"targetSlug":"sub2api"');
    expect(overrideCall?.body).toContain('"message":"Manual degradation"');

    result.announcementTitle.value = "Scheduled maintenance";
    result.announcementBody.value = "Expect partial traffic disruption.";
    result.submitAnnouncementButton.click();
    await Promise.resolve();
    await Promise.resolve();

    const announcementCall = calls.find(
      (call) =>
        call.url === "/api/admin/announcements" && call.method === "POST",
    );
    expect(announcementCall?.body).toContain('"title":"Scheduled maintenance"');
    expect(announcementCall?.body).toContain(
      '"body":"Expect partial traffic disruption."',
    );
    expect(result.adminStatus.textContent).toBe("Announcement published");
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
