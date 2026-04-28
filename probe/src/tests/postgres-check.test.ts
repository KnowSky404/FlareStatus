import { describe, expect, it, vi } from "vitest";
import { runPostgresCheck } from "../checks/postgres.js";

describe("runPostgresCheck", () => {
  it("returns operational when SELECT 1 succeeds", async () => {
    const connect = vi.fn(async () => undefined);
    const query = vi.fn(async () => ({ rows: [{ ok: 1 }] }));
    const end = vi.fn(async () => undefined);

    const result = await runPostgresCheck(
      {
        connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/app",
        timeoutMs: 500,
      },
      () => ({
        connect,
        query,
        end,
      }),
    );

    expect(result.status).toBe("operational");
    expect(result.summary).toContain("SELECT 1");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT 1");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("returns major_outage and closes the client when the query fails", async () => {
    const connect = vi.fn(async () => undefined);
    const query = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const end = vi.fn(async () => undefined);

    const result = await runPostgresCheck(
      {
        connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/app",
        timeoutMs: 500,
      },
      () => ({
        connect,
        query,
        end,
      }),
    );

    expect(result.status).toBe("major_outage");
    expect(result.summary).toMatch(/connection refused|timeout/i);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
