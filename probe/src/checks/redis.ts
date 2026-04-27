import type { CheckResult, RedisCheckConfig } from "../types.js";

export async function runRedisCheck(
  _config: RedisCheckConfig,
): Promise<CheckResult> {
  return {
    status: "major_outage",
    latencyMs: 0,
    summary: "redis check not implemented",
    checkedAt: new Date().toISOString(),
  };
}
