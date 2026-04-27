import { describe, expect, it, vi } from "vitest";
import { runHttpCheck } from "../checks/http.js";

describe("runHttpCheck", () => {
  it("returns operational for a healthy endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await runHttpCheck(
      {
        timeoutMs: 3000,
        url: "https://service.test/health",
        expectedStatus: [200],
      },
      fetcher,
    );

    expect(result.status).toBe("operational");
  });

  it("returns major_outage for an unexpected status code", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("nope", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await runHttpCheck(
      {
        timeoutMs: 3000,
        url: "https://service.test/health",
        expectedStatus: [200],
      },
      fetcher,
    );

    expect(result).toMatchObject({
      status: "major_outage",
      summary: "503",
    });
  });

  it("returns major_outage when fetch rejects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("boom"));

    const result = await runHttpCheck(
      {
        timeoutMs: 3000,
        url: "https://service.test/health",
        expectedStatus: [200],
      },
      fetcher,
    );

    expect(result).toMatchObject({
      status: "major_outage",
      summary: "boom",
    });
  });

  it("aborts the fetch signal on timeout and returns major_outage", async () => {
    vi.useFakeTimers();

    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal;

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    });

    try {
      const resultPromise = runHttpCheck(
        {
          timeoutMs: 25,
          url: "https://service.test/health",
          expectedStatus: [200],
        },
        fetcher,
      );

      await vi.advanceTimersByTimeAsync(25);

      const result = await resultPromise;

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(result.status).toBe("major_outage");
      expect(result.summary).toContain("aborted");
    } finally {
      vi.useRealTimers();
    }
  });
});
