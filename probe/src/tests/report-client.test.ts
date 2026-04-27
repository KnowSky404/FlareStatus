import { describe, expect, it, vi } from "vitest";
import { sendProbeReport } from "../client.js";
import { loadProbeConfig } from "../config.js";

describe("sendProbeReport", () => {
  it("throws when the ingest endpoint rejects the payload", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    globalThis.fetch = fetchMock;

    try {
      await expect(
        sendProbeReport("https://flarestatus.test/api/probe/report", "token", {
          componentSlug: "api",
          status: "major_outage",
        }),
      ).rejects.toThrow("probe report failed: 500");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://flarestatus.test/api/probe/report",
        expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer token",
          },
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts the report request when the ingest endpoint hangs", async () => {
    vi.useFakeTimers();

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal;

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });

    globalThis.fetch = fetchMock;

    try {
      const reportPromise = sendProbeReport(
        "https://flarestatus.test/api/probe/report",
        "token",
        {
          componentSlug: "api",
          status: "major_outage",
        },
        25,
      );
      const rejection = expect(reportPromise).rejects.toThrow(/aborted/i);

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});

describe("loadProbeConfig", () => {
  it("throws when expected statuses contain an invalid token", () => {
    expect(() =>
      loadProbeConfig({
        PROBE_COMPONENT_SLUG: "api",
        PROBE_REPORT_ENDPOINT: "https://flarestatus.test/api/probe/report",
        PROBE_REPORT_TOKEN: "token",
        PROBE_HTTP_URL: "https://service.test/health",
        PROBE_HTTP_TIMEOUT_MS: "3000",
        PROBE_HTTP_EXPECTED_STATUS: "200,20O",
      }),
    ).toThrow("Invalid PROBE_HTTP_EXPECTED_STATUS value: 200,20O");
  });

  it("throws when expected statuses fall outside the HTTP response range", () => {
    expect(() =>
      loadProbeConfig({
        PROBE_COMPONENT_SLUG: "api",
        PROBE_REPORT_ENDPOINT: "https://flarestatus.test/api/probe/report",
        PROBE_REPORT_TOKEN: "token",
        PROBE_HTTP_URL: "https://service.test/health",
        PROBE_HTTP_TIMEOUT_MS: "3000",
        PROBE_HTTP_EXPECTED_STATUS: "200,700",
      }),
    ).toThrow("Invalid PROBE_HTTP_EXPECTED_STATUS value: 200,700");
  });
});
