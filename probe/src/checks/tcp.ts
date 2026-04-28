import { Socket } from "node:net";
import type { CheckResult, TcpCheckConfig } from "../types.js";

interface TcpSocketLike {
  connect(port: number, host: string): unknown;
  setTimeout(timeoutMs: number): unknown;
  once(event: "connect", listener: () => void): unknown;
  once(event: "timeout", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  destroy(): unknown;
}

function buildResult(
  startedAt: number,
  status: CheckResult["status"],
  summary: string,
): CheckResult {
  return {
    status,
    latencyMs: Date.now() - startedAt,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

export async function runTcpCheck(
  config: TcpCheckConfig,
  createSocket: () => TcpSocketLike = () => new Socket(),
): Promise<CheckResult> {
  const startedAt = Date.now();

  return new Promise<CheckResult>((resolve) => {
    const socket = createSocket();
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => {
      finish(buildResult(startedAt, "operational", "connected"));
    });
    socket.once("timeout", () => {
      finish(buildResult(startedAt, "major_outage", "timeout"));
    });
    socket.once("error", (error) => {
      finish(buildResult(startedAt, "major_outage", error.message));
    });

    socket.setTimeout(config.timeoutMs);
    socket.connect(config.port, config.host);
  });
}
