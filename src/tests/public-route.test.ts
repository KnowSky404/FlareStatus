import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Env } from "../lib/env";
import worker from "../worker";

interface PublicStatusPayload {
  generatedAt: string;
  summary: { status: string };
  announcements: unknown[];
  services: Array<{
    slug: string;
    components: Array<{
      slug: string;
      displayStatus: string;
    }>;
  }>;
}

function createEnv(snapshot?: unknown): Env {
  return {
    ASSETS: ({
      fetch: async (_request) =>
        new Response("<html>status shell</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    } as Fetcher),
    DB: {} as D1Database,
    STATUS_SNAPSHOTS: ({
      get: async (key: string, options?: KVNamespaceGetOptions<"json">) => {
        expect(key).toBe("public:current");
        expect(options).toEqual({ type: "json" });

        return snapshot ?? null;
      },
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

async function runPublicApp({
  fetchImpl,
  summaryEl = { textContent: "Loading current system status..." },
}: {
  fetchImpl: typeof fetch;
  summaryEl?: { textContent: string } | null;
}) {
  const querySelector = (selector: string) => {
    expect(selector).toBe("#summary");
    return summaryEl;
  };

  const runScript = new AsyncFunction(
    "fetch",
    "document",
    publicAppScript,
  );

  await runScript(fetchImpl, { querySelector });

  return summaryEl;
}

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
      announcements: [],
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
      announcements: [],
    });
    expect(payload.services).toHaveLength(1);
    expect(payload.services[0]).toMatchObject({
      slug: "sub2api",
    });
    expect(payload.services[0]?.components).toHaveLength(1);
    expect(payload.services[0]?.components[0]).toMatchObject({
      slug: "sub2api-health",
      displayStatus: "degraded",
    });
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
});

describe("public status shell", () => {
  it("includes summary, services, and announcements regions", () => {
    const html = readFileSync("public/index.html", "utf8");
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="services"');
    expect(html).toContain('id="announcements"');
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
    const summaryEl = await runPublicApp({
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

  it("falls back when the status request fails", async () => {
    const summaryEl = await runPublicApp({
      fetchImpl: async () => {
        throw new Error("network failed");
      },
    });

    expect(summaryEl?.textContent).toBe("Unable to load current system status");
  });

  it("does nothing when the summary element is missing", async () => {
    await expect(
      runPublicApp({
        fetchImpl: async () => {
          throw new Error("should not be reached");
        },
        summaryEl: null,
      }),
    ).resolves.toBeNull();
  });
});
