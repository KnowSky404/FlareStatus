import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runTcpCheck } from "../checks/tcp.js";

class FakeSocket extends EventEmitter {
  public destroyed = false;

  connect = vi.fn((_port: number, _host: string) => this);
  setTimeout = vi.fn((_timeoutMs: number) => this);
  destroy = vi.fn(() => {
    this.destroyed = true;
    return this;
  });
}

describe("runTcpCheck", () => {
  it("returns operational when a TCP socket accepts the connection", async () => {
    const socket = new FakeSocket();

    const resultPromise = runTcpCheck(
      {
        host: "127.0.0.1",
        port: 6379,
        timeoutMs: 500,
      },
      () => socket as never,
    );

    socket.emit("connect");

    const result = await resultPromise;

    expect(result.status).toBe("operational");
    expect(result.summary).toContain("connected");
    expect(socket.connect).toHaveBeenCalledWith(6379, "127.0.0.1");
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("returns major_outage when the socket emits an error", async () => {
    const socket = new FakeSocket();

    const resultPromise = runTcpCheck(
      {
        host: "127.0.0.1",
        port: 6379,
        timeoutMs: 500,
      },
      () => socket as never,
    );

    socket.emit("error", new Error("connection refused"));

    const result = await resultPromise;

    expect(result.status).toBe("major_outage");
    expect(result.summary).toMatch(/connection refused|timeout/i);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});
