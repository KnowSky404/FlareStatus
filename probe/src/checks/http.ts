import type { CheckResult, HttpCheckConfig } from "../types.js";

export async function runHttpCheck(
  config: HttpCheckConfig,
  fetcher: typeof fetch = fetch,
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetcher(config.url, {
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const healthy = config.expectedStatus.includes(response.status);

    return {
      status: healthy ? "operational" : "major_outage",
      latencyMs,
      summary: `${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const summary = error instanceof Error ? error.message : String(error);

    return {
      status: "major_outage",
      latencyMs,
      summary,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
