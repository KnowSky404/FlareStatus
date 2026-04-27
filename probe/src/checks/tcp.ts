import type { CheckResult, TcpCheckConfig } from "../types.js";

export async function runTcpCheck(_config: TcpCheckConfig): Promise<CheckResult> {
  return {
    status: "major_outage",
    latencyMs: 0,
    summary: "tcp check not implemented",
    checkedAt: new Date().toISOString(),
  };
}
