import type { ProbeConfig } from "./types.js";

const DEFAULT_HTTP_TIMEOUT_MS = 3000;
const DEFAULT_LOOP_INTERVAL_MS = 30000;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseTimeout(value: string | undefined): number {
  if (!value) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PROBE_HTTP_TIMEOUT_MS value: ${value}`);
  }

  return parsed;
}

function parseExpectedStatuses(value: string | undefined): number[] {
  if (!value) {
    return [200];
  }

  const parsed = value.split(",").map((entry) => {
    const trimmed = entry.trim();

    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid PROBE_HTTP_EXPECTED_STATUS value: ${value}`);
    }

    return Number(trimmed);
  });

  if (
    parsed.length === 0 ||
    parsed.some((entry) => !Number.isInteger(entry) || entry < 100 || entry > 599)
  ) {
    throw new Error(`Invalid PROBE_HTTP_EXPECTED_STATUS value: ${value}`);
  }

  return parsed;
}

function parsePositiveInteger(
  value: string | undefined,
  envName: string,
  defaultValue: number,
): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName} value: ${value}`);
  }

  return parsed;
}

function requirePositiveInteger(
  env: NodeJS.ProcessEnv,
  envName: string,
): number {
  return parsePositiveInteger(requireEnvFrom(env, envName), envName, 0);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid PROBE_RUN_ONCE value: ${value}`);
}

function loadCheckConfig(env: NodeJS.ProcessEnv): ProbeConfig["check"] {
  const type = env.PROBE_CHECK_TYPE ?? "http";

  switch (type) {
    case "http":
      return {
        type: "http",
        url: requireEnvFrom(env, "PROBE_HTTP_URL"),
        timeoutMs: parseTimeout(env.PROBE_HTTP_TIMEOUT_MS),
        expectedStatus: parseExpectedStatuses(env.PROBE_HTTP_EXPECTED_STATUS),
      };
    case "tcp":
      return {
        type: "tcp",
        host: requireEnvFrom(env, "PROBE_TCP_HOST"),
        port: requirePositiveInteger(env, "PROBE_TCP_PORT"),
        timeoutMs: parsePositiveInteger(
          env.PROBE_TCP_TIMEOUT_MS,
          "PROBE_TCP_TIMEOUT_MS",
          DEFAULT_HTTP_TIMEOUT_MS,
        ),
      };
    case "redis":
      return {
        type: "redis",
        url: requireEnvFrom(env, "PROBE_REDIS_URL"),
        timeoutMs: parsePositiveInteger(
          env.PROBE_REDIS_TIMEOUT_MS,
          "PROBE_REDIS_TIMEOUT_MS",
          DEFAULT_HTTP_TIMEOUT_MS,
        ),
      };
    case "postgres":
      return {
        type: "postgres",
        connectionString: requireEnvFrom(env, "PROBE_POSTGRES_CONNECTION_STRING"),
        timeoutMs: parsePositiveInteger(
          env.PROBE_POSTGRES_TIMEOUT_MS,
          "PROBE_POSTGRES_TIMEOUT_MS",
          DEFAULT_HTTP_TIMEOUT_MS,
        ),
      };
    default:
      throw new Error(`Invalid PROBE_CHECK_TYPE value: ${type}`);
  }
}

export function loadProbeConfig(env: NodeJS.ProcessEnv = process.env): ProbeConfig {
  return {
    componentSlug: requireEnvFrom(env, "PROBE_COMPONENT_SLUG"),
    reportEndpoint: requireEnvFrom(env, "PROBE_REPORT_ENDPOINT"),
    reportToken: requireEnvFrom(env, "PROBE_REPORT_TOKEN"),
    intervalMs: parsePositiveInteger(
      env.PROBE_INTERVAL_MS,
      "PROBE_INTERVAL_MS",
      DEFAULT_LOOP_INTERVAL_MS,
    ),
    runOnce: parseBoolean(env.PROBE_RUN_ONCE),
    check: loadCheckConfig(env),
  };
}

function requireEnvFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
