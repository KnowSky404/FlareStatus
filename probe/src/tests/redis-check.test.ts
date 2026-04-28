import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runRedisCheck } from "../checks/redis.js";

class FakeSocket extends EventEmitter {
  public destroyed = false;

  connect = vi.fn((_port: number, _host: string) => this);
  setTimeout = vi.fn((_timeoutMs: number) => this);
  write = vi.fn((_payload: string) => true);
  destroy = vi.fn(() => {
    this.destroyed = true;
    return this;
  });
}

describe("runRedisCheck", () => {
  it("returns operational on a valid PONG reply", async () => {
    const socket = new FakeSocket();

    const resultPromise = runRedisCheck(
      {
        url: "redis://127.0.0.1:6379",
        timeoutMs: 500,
      },
      () => socket as never,
    );

    socket.emit("connect");
    socket.emit("data", Buffer.from("+PONG\r\n"));

    const result = await resultPromise;

    expect(result.status).toBe("operational");
    expect(result.summary).toContain("PONG");
    expect(socket.write).toHaveBeenCalledWith("*1\r\n$4\r\nPING\r\n");
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("returns major_outage on an unexpected redis reply", async () => {
    const socket = new FakeSocket();

    const resultPromise = runRedisCheck(
      {
        url: "redis://127.0.0.1:6379",
        timeoutMs: 500,
      },
      () => socket as never,
    );

    socket.emit("connect");
    socket.emit("data", Buffer.from("-ERR nope\r\n"));

    const result = await resultPromise;

    expect(result.status).toBe("major_outage");
    expect(result.summary).toMatch(/ERR|unexpected/i);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});
