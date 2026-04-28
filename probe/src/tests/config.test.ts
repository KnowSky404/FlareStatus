import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProbeConfig } from "../config.js";
import { runProbeLoop, runSingleProbe } from "../index.js";

vi.mock("../client.js", () => ({
  sendProbeReport: vi.fn(),
}));

vi.mock("../checks/http.js", () => ({
  runHttpCheck: vi.fn(),
}));

import { sendProbeReport } from "../client.js";
import { runHttpCheck } from "../checks/http.js";

const sendProbeReportMock = vi.mocked(sendProbeReport);
const runHttpCheckMock = vi.mocked(runHttpCheck);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("loadProbeConfig", () => {
  it("loads the default HTTP check shape and loop interval", () => {
    const config = loadProbeConfig({
      PROBE_COMPONENT_SLUG: "api",
      PROBE_REPORT_ENDPOINT: "https://flarestatus.test/api/probe/report",
      PROBE_REPORT_TOKEN: "token",
      PROBE_HTTP_URL: "https://service.test/health",
    });

    expect(config.intervalMs).toBe(30000);
    expect(config.check).toEqual({
      type: "http",
      url: "https://service.test/health",
      timeoutMs: 3000,
      expectedStatus: [200],
    });
  });
});

describe("probe runtime", () => {
  it("runs a single probe and reports the result", async () => {
    runHttpCheckMock.mockResolvedValue({
      status: "operational",
      latencyMs: 120,
      checkedAt: "2026-04-27T10:00:00.000Z",
      summary: "200",
    });

    const result = await runSingleProbe({
      componentSlug: "api",
      reportEndpoint: "https://flarestatus.test/api/probe/report",
      reportToken: "token",
      intervalMs: 30000,
      check: {
        type: "http",
        url: "https://service.test/health",
        timeoutMs: 3000,
        expectedStatus: [200],
      },
    });

    expect(result.status).toBe("operational");
    expect(runHttpCheckMock).toHaveBeenCalledTimes(1);
    expect(sendProbeReportMock).toHaveBeenCalledWith(
      "https://flarestatus.test/api/probe/report",
      "token",
      {
        componentSlug: "api",
        status: "operational",
        latencyMs: 120,
        checkedAt: "2026-04-27T10:00:00.000Z",
        summary: "200",
      },
    );
  });

  it("emits repeated reports in loop mode", async () => {
    vi.useFakeTimers();

    runHttpCheckMock.mockResolvedValue({
      status: "operational",
      latencyMs: 120,
      checkedAt: "2026-04-27T10:00:00.000Z",
      summary: "200",
    });

    const scheduler = {
      setInterval: vi.fn((callback: () => void, intervalMs: number) => {
        expect(intervalMs).toBe(30000);
        return globalThis.setInterval(callback, intervalMs);
      }),
      clearInterval: vi.fn((timer: ReturnType<typeof setInterval>) => {
        globalThis.clearInterval(timer);
      }),
    };

    const stop = await runProbeLoop(
      {
        componentSlug: "api",
        reportEndpoint: "https://flarestatus.test/api/probe/report",
        reportToken: "token",
        intervalMs: 30000,
        check: {
          type: "http",
          url: "https://service.test/health",
          timeoutMs: 3000,
          expectedStatus: [200],
        },
      },
      scheduler,
    );

    await vi.advanceTimersByTimeAsync(60000);
    await Promise.resolve();
    await Promise.resolve();
    stop();

    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
    expect(scheduler.clearInterval).toHaveBeenCalledTimes(1);
    expect(sendProbeReportMock).toHaveBeenCalledTimes(2);
  });
});
