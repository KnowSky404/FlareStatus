import { describe, expect, it } from "vitest";
import type { Env } from "../lib/env";
import worker from "../worker";

describe("worker asset shell", () => {
  it("returns the static shell for the homepage", async () => {
    const env: Env = {
      ASSETS: ({
        fetch: async (_request) =>
          new Response("<html>status shell</html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      } as Fetcher),
      DB: {} as D1Database,
      STATUS_SNAPSHOTS: {} as KVNamespace,
      PROBE_API_TOKEN: "probe-token",
      ADMIN_API_TOKEN: "admin-token",
    };

    const ctx: ExecutionContext = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    };

    const response = await worker.fetch(
      new Request("https://flarestatus.test/"),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("status shell");
  });
});
