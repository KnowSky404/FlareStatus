import { sendProbeReport } from "./client.js";
import { runPostgresCheck, runRedisCheck, runTcpCheck } from "./checks/index.js";
import { runHttpCheck } from "./checks/http.js";
import { loadProbeConfig } from "./config.js";
import type { CheckResult, ProbeConfig } from "./types.js";

interface ProbeScheduler {
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

const defaultScheduler: ProbeScheduler = {
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

async function runCheck(config: ProbeConfig["check"]): Promise<CheckResult> {
  switch (config.type) {
    case "http":
      return runHttpCheck(config);
    case "tcp":
      return runTcpCheck(config);
    case "redis":
      return runRedisCheck(config);
    case "postgres":
      return runPostgresCheck(config);
  }
}

export async function runSingleProbe(config: ProbeConfig) {
  const result = await runCheck(config.check);

  await sendProbeReport(config.reportEndpoint, config.reportToken, {
    componentSlug: config.componentSlug,
    status: result.status,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
    summary: result.summary,
  });

  return result;
}

export async function runProbeLoop(
  config: ProbeConfig,
  scheduler: ProbeScheduler = defaultScheduler,
) {
  const timer = scheduler.setInterval(() => {
    void runSingleProbe(config).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
    });
  }, config.intervalMs);

  return () => {
    scheduler.clearInterval(timer);
  };
}

export async function runProbe() {
  const config = loadProbeConfig();

  if (config.runOnce) {
    return runSingleProbe(config);
  }

  return runProbeLoop(config);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProbe().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
