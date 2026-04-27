import type { CheckResult, PostgresCheckConfig } from "../types.js";

export async function runPostgresCheck(
  _config: PostgresCheckConfig,
): Promise<CheckResult> {
  return {
    status: "major_outage",
    latencyMs: 0,
    summary: "postgres check not implemented",
    checkedAt: new Date().toISOString(),
  };
}
