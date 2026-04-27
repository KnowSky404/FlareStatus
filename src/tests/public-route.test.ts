import { describe, expect, it } from "vitest";
import type { Env } from "../lib/env";
import worker from "../worker";

interface PublicStatusPayload {
  generatedAt: string;
  summary: { status: string };
  announcements: unknown[];
  services: unknown[];
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
          components: [],
        },
      ],
    });

    const response = await worker.fetch(
      new Request("https://flarestatus.test/api/public/status"),
      env,
      createCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-04-27T10:00:00.000Z",
      summary: { status: "degraded" },
      announcements: [],
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          status: "degraded",
          components: [],
        },
      ],
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
