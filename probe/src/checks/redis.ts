import { Socket } from "node:net";
import type { CheckResult, RedisCheckConfig } from "../types.js";

interface RedisSocketLike {
  connect(port: number, host: string): unknown;
  setTimeout(timeoutMs: number): unknown;
  write(payload: string): unknown;
  once(event: "connect", listener: () => void): unknown;
  once(event: "data", listener: (chunk: Buffer) => void): unknown;
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

export async function runRedisCheck(
  config: RedisCheckConfig,
  createSocket: () => RedisSocketLike = () => new Socket(),
): Promise<CheckResult> {
  const startedAt = Date.now();
  const url = new URL(config.url);
  const host = url.hostname;
  const port = Number(url.port || "6379");

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
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    socket.once("data", (chunk) => {
      const summary = chunk.toString("utf8").trim();

      if (summary === "+PONG") {
        finish(buildResult(startedAt, "operational", "PONG"));
        return;
      }

      finish(buildResult(startedAt, "major_outage", summary || "unexpected reply"));
    });
    socket.once("timeout", () => {
      finish(buildResult(startedAt, "major_outage", "timeout"));
    });
    socket.once("error", (error) => {
      finish(buildResult(startedAt, "major_outage", error.message));
    });

    socket.setTimeout(config.timeoutMs);
    socket.connect(port, host);
  });
}
