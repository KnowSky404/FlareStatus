import { Client } from "pg";
import type { CheckResult, PostgresCheckConfig } from "../types.js";

interface PostgresClientLike {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
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

export async function runPostgresCheck(
  config: PostgresCheckConfig,
  createClient: () => PostgresClientLike = () =>
    new Client({
      connectionString: config.connectionString,
      connectionTimeoutMillis: config.timeoutMs,
      query_timeout: config.timeoutMs,
      statement_timeout: config.timeoutMs,
    }),
): Promise<CheckResult> {
  const startedAt = Date.now();
  const client = createClient();

  try {
    await client.connect();
    await client.query("SELECT 1");

    return buildResult(startedAt, "operational", "SELECT 1 ok");
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);

    return buildResult(startedAt, "major_outage", summary);
  } finally {
    await client.end();
  }
}
